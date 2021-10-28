/**
 * @license
 * Copyright (C) 2020-2021 Pryv S.A. https://pryv.com 
 * 
 * This file is part of Open-Pryv.io and released under BSD-Clause-3 License
 * 
 * Redistribution and use in source and binary forms, with or without 
 * modification, are permitted provided that the following conditions are met:
 * 
 * 1. Redistributions of source code must retain the above copyright notice, 
 *    this list of conditions and the following disclaimer.
 * 
 * 2. Redistributions in binary form must reproduce the above copyright notice, 
 *    this list of conditions and the following disclaimer in the documentation 
 *    and/or other materials provided with the distribution.
 * 
 * 3. Neither the name of the copyright holder nor the names of its contributors 
 *    may be used to endorse or promote products derived from this software 
 *    without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" 
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE 
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, 
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE 
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 * SPDX-License-Identifier: BSD-3-Clause
 */
var errors = require('errors').factory,
  async = require('async'),
  commonFns = require('./helpers/commonFunctions'),
  errorHandling = require('errors').errorHandling,
  methodsSchema = require('../schema/streamsMethods'),
  streamSchema = require('../schema/stream'),
  slugify = require('slug'),
  string = require('./helpers/string'),
  utils = require('utils'),
  treeUtils = utils.treeUtils,
  _ = require('lodash');

const bluebird = require('bluebird');
const SystemStreamsSerializer = require('business/src/system-streams/serializer');
const ErrorMessages = require('errors/src/ErrorMessages');
const ErrorIds = require('errors/src/ErrorIds');

const { getLogger, getConfig } = require('@pryv/boiler');
const logger = getLogger('methods:streams');
const { getMall, StreamsUtils } = require('mall');
const { changePrefixIdForStreams, replaceWithNewPrefix } = require('./helpers/backwardCompatibility');
const { pubsub } = require('messages');
const { getStorageLayer } = require('storage');

SystemStreamsSerializer.getSerializer(); // ensure it's loaded

/**
 * Event streams API methods implementation.
 *
 * @param api
 * @param userStreamsStorage
 * @param userEventsStorage
 * @param userEventFilesStorage
 * @param notifyTests
 * @param logging
 * @param auditSettings
 * @param updatesSettings
 */
module.exports = async function (api) {
  const config = await getConfig();
  const storageLayer = await getStorageLayer();
  const userStreamsStorage = storageLayer.streams;
  const userEventsStorage = storageLayer.events;
  const userEventFilesStorage = storageLayer.eventFiles;
  const auditSettings = config.get('versioning');
  const updatesSettings = config.get('updates');
  const mall = await getMall();

  const isStreamIdPrefixBackwardCompatibilityActive: boolean = config.get('backwardCompatibility:systemStreams:prefix:isActive');

  // RETRIEVAL
  api.register('streams.get',
    commonFns.getParamsValidation(methodsSchema.get.params),
    checkAuthorization,
    applyDefaultsForRetrieval,
    findAccessibleStreams,
    includeDeletionsIfRequested
  );

  function applyDefaultsForRetrieval(context, params, result, next) {
    _.defaults(params, {
      parentId: null,
      includeDeletionsSince: null
    });
    next();
  }

  async function checkAuthorization(context, params, result, next) {
    if (params.parentId && params.id) {
      DataStore.throwInvalidRequestStructure('Do not mix "parentId" and "id" parameter in request');
    }
    
    if (params.parentId) {
      if (isStreamIdPrefixBackwardCompatibilityActive && ! context.disableBackwardCompatibility) {
        params.parentId = replaceWithNewPrefix(params.parentId);
      }
    }

    let streamId = params.id || params.parentId || null;
    if (! streamId ) return next(); // "*" is authorized for everyone

    if (! await context.access.canListStream(streamId)) {
      return next(errors.forbidden('Insufficient permissions or non-existant stream [' + streamId + ']'));
    }
    return next();
  }

  async function findAccessibleStreams(context, params, result, next) {
    
    if (params.parentId) {
      if (isStreamIdPrefixBackwardCompatibilityActive && ! context.disableBackwardCompatibility) {
        params.parentId = replaceWithNewPrefix(params.parentId);
      }
    }

    let streamId = params.id || params.parentId || '*';

    let storeId = params.storeId; // might me null
    if (storeId == null) {
      [storeId, streamId] = StreamsUtils.storeIdAndStreamIdForStreamId(streamId);
    }
   
    let streams = await mall.streams.get(context.user.id, 
      {
        id: streamId,
        storeId: storeId,
        expandChildren: true,
        includeDeletionsSince: params.includeDeletionsSince,
        includeTrashed: params.includeTrashed || params.state === 'all',
        excludedIds: context.access.getCannotListStreamsStreamIds(storeId),
      });
 
    if (streamId !== '*') {
      const fullStreamId = StreamsUtils.streamIdForStoreId(streamId, storeId);
      const inResult = treeUtils.findById(streams, fullStreamId);
      if (!inResult) {
        return next(errors.unknownReferencedResource('unkown Stream:', params.parentId ? 'parentId' : 'id', fullStreamId, null));
      }
    } else if (! await context.access.canListStream('*')) { // request is "*" and not personal access
      // cherry pick accessible streams from result
      /********************************
       * This is not optimal (fetches all streams) and not accurate 
       * This method can "duplicate" streams, if read rights have been given to a parent and one of it's children
       * Either:
       *  - detect parent / child relationships
       *  - pass a list of streamIds to store.streams.get() to get a consolidated answer 
       *********************************/
      const listables = context.access.getListableStreamIds();
      const filteredStreams = [];
      for (const listable of listables) {
        const listableFullStreamId = StreamsUtils.streamIdForStoreId(listable.streamId, listable.storeId);
        const inResult = treeUtils.findById(streams, listableFullStreamId);
        if (inResult) {
          const copy = _.cloneDeep(inResult);
          filteredStreams.push(copy);
        } else {
          if (storeId === 'local' && listable.storeId !== 'local') {
            // fetch stream structures for listables not in local and add it to the result
            const listableStreamAndChilds = await mall.streams.get(context.user.id, 
              {
                id: listable.streamId,
                storeId: listable.storeId,
                expandChildren: true,
                includeDeletionsSince: params.includeDeletionsSince,
                includeTrashed: params.includeTrashed || params.state === 'all',
                excludedIds: context.access.getCannotListStreamsStreamIds(listable.storeId),
              });
            filteredStreams.push(...listableStreamAndChilds);
          }
        }
      }
      streams = filteredStreams;
    } 

    // remove non visible parentIds from 
    for (const rootStream of streams) { 
      if ((rootStream.parentId != null) && (! await context.access.canListStream(rootStream.parentId))) {
        rootStream.parentId = null;
      }
    };

    // if request was made on parentId .. return only the children
    if (params.parentId && streams.length === 1) {
      streams = streams[0].children;
    } 

    if (isStreamIdPrefixBackwardCompatibilityActive && ! context.disableBackwardCompatibility) {
      streams = changePrefixIdForStreams(streams);
    }

    result.streams = streams;
    next();
  }

  function includeDeletionsIfRequested(context, params, result, next) {
    if (params.includeDeletionsSince == null) { return next(); }

    var options = {
      sort: { deleted: -1 }
    };

    userStreamsStorage.findDeletions(context.user, params.includeDeletionsSince, options,
      function (err, deletions) {
        if (err) { return next(errors.unexpectedError(err)); }

        result.streamDeletions = deletions;
        next();
      });
  }

  // CREATION

  api.register('streams.create',
    forbidSystemStreamsActions,
    commonFns.getParamsValidation(methodsSchema.create.params),
    applyDefaultsForCreation,
    applyPrerequisitesForCreation,
    createStream);

  function applyDefaultsForCreation(context, params, result, next) {
    _.defaults(params, { parentId: null });
    next();
  }

  async function applyPrerequisitesForCreation(context, params, result, next) {
    if (! await context.access.canCreateChildOnStream(params.parentId)) {
      return process.nextTick(next.bind(null, errors.forbidden()));
    }

    // strip ignored properties
    if (params.hasOwnProperty('children')) {
      delete params.children;
    }

    if (params.id) {
      if (string.isReservedId(params.id) ||
        string.isReservedId(params.id = slugify(params.id))) {
        return process.nextTick(next.bind(null, errors.invalidItemId(
          'The specified id "' + params.id + '" is not allowed.')));
      }
    }

    context.initTrackingProperties(params);

    next();
  }

  function createStream(context, params, result, next) {
    userStreamsStorage.insertOne(context.user, params, function (err, newStream) {
      if (err != null) {
        // Duplicate errors
        if (err.isDuplicate) {
          if (err.isDuplicateIndex('streamId')) {
            return next(errors.itemAlreadyExists(
              'stream', { id: params.id }, err));
          }
          if (err.isDuplicateIndex('name')) {
            return next(errors.itemAlreadyExists(
              'sibling stream', { name: params.name }, err));
          }
        }
        // Unknown parent stream error
        else if (params.parentId != null) {
          return next(errors.unknownReferencedResource(
            'parent stream', 'parentId', params.parentId, err
          ));
        }
        // Any other error
        return next(errors.unexpectedError(err));
      }

      result.stream = newStream;
      pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_STREAMS_CHANGED);
      next();
    });
  }

  // UPDATE

  api.register('streams.update',
    forbidSystemStreamsActions,
    commonFns.getParamsValidation(methodsSchema.update.params),
    commonFns.catchForbiddenUpdate(streamSchema('update'), updatesSettings.ignoreProtectedFields, logger),
    applyPrerequisitesForUpdate,
    updateStream);

  /**
   * Forbid to create or modify system streams, or add children to them
   * 
   * @param {*} context 
   * @param {*} params 
   * @param {*} result 
   * @param {*} next 
   */
  function forbidSystemStreamsActions (context, params, result, next) {
    if (params.id != null) {
      if (isStreamIdPrefixBackwardCompatibilityActive && ! context.disableBackwardCompatibility) {
        params.id = replaceWithNewPrefix(params.id);
      }

      if (SystemStreamsSerializer.isSystemStreamId(params.id)) {
        return next(errors.invalidOperation(
          ErrorMessages[ErrorIds.ForbiddenAccountStreamsModification])
        );
      }
    }
    if (params.parentId != null) {
      if (isStreamIdPrefixBackwardCompatibilityActive && ! context.disableBackwardCompatibility) {
        params.parentId = replaceWithNewPrefix(params.parentId);
      }
      
      if (SystemStreamsSerializer.isSystemStreamId(params.parentId)) {
        return next(errors.invalidOperation(
          ErrorMessages[ErrorIds.ForbiddenAccountStreamsModification])
        );
      }
    }
    
    next();
  }

  async function applyPrerequisitesForUpdate(context, params, result, next) {
    if (params?.update?.parentId === params.id) {
      return next(errors.invalidOperation('The provided "parentId" is the same as the stream\'s "id".', params.update));
    }

    // check stream
    var stream = await context.streamForStreamId(params.id);
    if (!stream) {
      return process.nextTick(next.bind(null,
        errors.unknownResource(
          'stream', params.id
        )
      ));
    }

    if (!await context.access.canUpdateStream(stream.id)) {
      return process.nextTick(next.bind(null, errors.forbidden()));
    }

    // check target parent if needed
    if (params.update.parentId && ! await context.access.canCreateChildOnStream(params.update.parentId)) {
      return process.nextTick(next.bind(null, errors.forbidden()));
    }

    context.updateTrackingProperties(params.update);

    next();
  }

  function updateStream(context, params, result, next) {
    userStreamsStorage.updateOne(context.user, { id: params.id }, params.update,
      function (err, updatedStream) {
        if (err != null) {
          // Duplicate error
          if (err.isDuplicate) {
            if (err.isDuplicateIndex('name')) {
              return next(errors.itemAlreadyExists(
                'sibling stream', { name: params.update.name }, err
              ));
            }
          }
          // Unknown parent stream error
          else if (params.update.parentId != null) {
            return next(errors.unknownReferencedResource(
              'parent stream', 'parentId', params.update.parentId, err
            ));
          }
          // Any other error
          return next(errors.unexpectedError(err));
        }

        result.stream = updatedStream;
        pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_STREAMS_CHANGED);
        next();
      });
  }

  // DELETION

  api.register('streams.delete',
    forbidSystemStreamsActions,
    commonFns.getParamsValidation(methodsSchema.del.params),
    verifyStreamExistenceAndPermissions,
    deleteStream);

  async function verifyStreamExistenceAndPermissions(context, params, result, next) {
    _.defaults(params, { mergeEventsWithParent: null });

    context.stream = await context.streamForStreamId(params.id); 
    if (context.stream == null) {
      return process.nextTick(next.bind(null,
        errors.unknownResource('stream', params.id)));
      }
    if (! await context.access.canDeleteStream(context.stream.id)) {
      return process.nextTick(next.bind(null, errors.forbidden()));
    }

    next();
  }

  function deleteStream(context, params, result, next) {
    if (context.stream.trashed == null) {
      // move to trash
      flagAsTrashed(context, params, result, next);
    } else {
      // actually delete
      deleteWithData(context, params, result, next);
    }
  }

  function flagAsTrashed(context, params, result, next) {
    var updatedData = { trashed: true };
    context.updateTrackingProperties(updatedData);

    userStreamsStorage.updateOne(context.user, { id: params.id }, updatedData,
      function (err, updatedStream) {
        if (err) { return next(errors.unexpectedError(err)); }

        result.stream = updatedStream;
        pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_STREAMS_CHANGED);
        next();
      });
  }

  function deleteWithData(context, params, result, next) {
    let streamAndDescendantIds,
      parentId,
      hasLinkedEvents;
    async.series([
      function retrieveStreamIdsToDelete(stepDone) {
        userStreamsStorage.find(context.user, {}, null, function (err, streams) {
          if (err) {
            return stepDone(errors.unexpectedError(err));
          }
          // isnt this the same as context.stream
          var streamToDelete = treeUtils.findById(streams, params.id);
          //no need to check existence: done before already
          streamAndDescendantIds = treeUtils.collectPluckFromRootItem(streamToDelete, 'id');
          parentId = streamToDelete.parentId;

          stepDone();
        });
      },
      function checkIfRootStreamAndLinkedEventsExist(stepDone) {
        if (params.mergeEventsWithParent === true && parentId == null) {
          return stepDone(errors.invalidOperation(
            'Deleting a root stream with mergeEventsWithParent=true is rejected ' +
            'since there is no parent stream to merge linked events in.',
            { streamId: params.id }));
        }

        userEventsStorage.find(context.user, {streamIds: { $in: streamAndDescendantIds }},
          { limit: 1 }, function (err, events) {
            if (err) {
              return stepDone(errors.unexpectedError(err));
            }

            hasLinkedEvents = !!events.length;

            if (hasLinkedEvents && params.mergeEventsWithParent === null) {
              return stepDone(errors.invalidParametersFormat(
                'There are events referring to the deleted items ' +
                'and the `mergeEventsWithParent` parameter is missing.'));
            }

            stepDone();
          });
      },

      function handleLinkedEvents(stepDone) {
        if (!hasLinkedEvents) {
          return stepDone();
        }

        if (params.mergeEventsWithParent) {
          async.series([
            function generateLogIfNecessary(subStepDone) {
              if (!auditSettings.forceKeepHistory) {
                return subStepDone();
              }
              userEventsStorage.findStreamed(context.user,
                { streamIds: { $in: streamAndDescendantIds }}, null,
                function (err, eventsStream) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }

                  let eventToVersion;
                  eventsStream.on('data', (event) => {
                    eventToVersion = _.extend(event, { headId: event.id });
                    delete eventToVersion.id;
                    userEventsStorage.insertOne(context.user, eventToVersion,
                      function (err) {
                        if (err) {
                          return subStepDone(errors.unexpectedError(err));
                        }
                      });
                  });

                  eventsStream.on('error', (err) => {
                    subStepDone(errors.unexpectedError(err));
                  });

                  eventsStream.on('end', () => {
                    subStepDone();
                  });

                });
            },
            function addParentStreamIdIfNeeded(subStepDone) {
              userEventsStorage.updateMany(context.user,
                { streamIds: { $ne: parentId, $in: streamAndDescendantIds }, headId: { $exists: false } }, // not already containing parentId 
                { 'streamIds.$': parentId }, // set first element only (not multi)
                function (err) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }
                  pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_EVENTS_CHANGED);
                  subStepDone();
                });
            },
            function removeStreamdIds(subStepDone) {
              userEventsStorage.updateMany(context.user,
                { streamIds: { $in: streamAndDescendantIds }, headId: { $exists: false } },
                { $pull: { streamIds: { $in: streamAndDescendantIds } } },
                function (err) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }
                  subStepDone();
                }
              );
            }
          ], stepDone);
        } else {
          // case mergeEventsWithParent = false

          async.series([
            function handleHistory(subStepDone) {
              if (auditSettings.deletionMode === 'keep-everything') {

                // history is untouched
                return subStepDone();
              } else if (auditSettings.deletionMode === 'keep-authors') {

                userEventsStorage.findStreamed(context.user,
                  { streamIds: { $in: streamAndDescendantIds } }, { projection: { id: 1 } },
                  function (err, eventsStream) {
                    if (err) {
                      return subStepDone(errors.unexpectedError(err));
                    }
                    eventsStream.on('data', (head) => {
                      userEventsStorage.minimizeEventsHistory(context.user, head.id,
                        function (err) {
                          if (err) {
                            return subStepDone(errors.unexpectedError(err));
                          }
                        });
                    });

                    eventsStream.on('error', (err) => {
                      subStepDone(errors.unexpectedError(err));
                    });

                    eventsStream.on('end', () => {
                      subStepDone();
                    });

                  });
              } else {
                // default: deletionMode='keep-nothing'

                userEventsStorage.findStreamed(context.user,
                  { streamIds: { $in: streamAndDescendantIds } },
                  { projection: { id: 1, streamIds: 1 } },
                  function (err, eventsStream) {
                    if (err) {
                      return subStepDone(errors.unexpectedError(err));
                    }
                    eventsStream.on('data', (head) => {
                      // multiple StreamIds &&
                      // the streams to delete are NOT ALL in the streamAndDescendantIds list
                      if (head.streamIds.length > 1 && 
                        ! arrayAIsIncludedInB(head.streamIds, streamAndDescendantIds)) {
                          // event is still attached to existing streamId(s)
                          // we will remove the streamIds later on
                      } else {
                        // remove the events
                        userEventsStorage.removeMany(context.user, { headId: head.id },
                          function (err) {
                            if (err) {
                              return subStepDone(errors.unexpectedError(err));
                            }
                          });
                      }
                    });

                    eventsStream.on('error', (err) => {
                      subStepDone(errors.unexpectedError(err));
                    });

                    eventsStream.on('end', () => {
                      subStepDone();
                    });
                  });
              }
            },
            function deleteEventsWithAttachments(subStepDone) {
              userEventsStorage.findStreamed(context.user,
                { 
                  streamIds: { $in: streamAndDescendantIds }, 
                  attachments: { $exists: true }
                },
                { projection: { id: 1, streamIds: 1 } },
                function (err, eventsStream) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }

                  eventsStream.on('data', (event) => {
                    // multiple StreamIds &&
                    // the streams to delete are NOT ALL in the streamAndDescendantIds list
                    if (event.streamIds.length > 1 &&
                      ! arrayAIsIncludedInB(event.streamIds, streamAndDescendantIds)) {
                      // event is still attached to existing streamId(s)
                      // we will remove the streamIds later on
                    } else {
                      userEventFilesStorage.removeAllForEvent(context.user, event.id, function (err) {
                        if (err) {
                          // async delete attached files (if any) – don't wait for
                          // this, just log possible errors
                          errorHandling.logError(err, null, logger);
                        }
                      });
                    }
                  });

                  eventsStream.on('error', (err) => {
                    subStepDone(errors.unexpectedError(err));
                  });
                  
                  eventsStream.on('end', () => {
                    subStepDone();
                  });    
                }
              );
            },
            function removeStreamdIdsFromAllEvents(subStepDone) {
              if (auditSettings.deletionMode === 'keep-everything') {
                // not removing anything
                return subStepDone();
              }
              userEventsStorage.updateMany(context.user,
                { streamIds: { $in: streamAndDescendantIds }, headId: { $exists: false } },
                { $pull: { streamIds: { $in: streamAndDescendantIds } } },
                function (err) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }
                  subStepDone();
                }
              );
            },
            function deleteEvents(subStepDone) {
              const filter = {
                headId: { $exists: false },
              };
              if (auditSettings.deletionMode === 'keep-everything') {
                // they still have all their streamIds
                filter.streamIds = { $in: streamAndDescendantIds };
              } else {
                // their streamIds were removed by removeStreamdIdsFromAllEvents()
                filter.streamIds = [];
              }
              
              // we do a "raw" delete on all streamless events 
              // we do not want to change the "modifiedBy" and "modifiedDate"
              // to prevent running condition where another process would 
              // delete these data and mark the vent modified
              userEventsStorage.delete(context.user,
                filter,
                auditSettings.deletionMode, function (err) {
                  if (err) {
                    return subStepDone(errors.unexpectedError(err));
                  }
                  pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_EVENTS_CHANGED);
                  subStepDone();
                });
            }
          ], stepDone);
        }
      },
      function deleteStreams(stepDone) {
        userStreamsStorage.delete(
          context.user,
          { id: { $in: streamAndDescendantIds } },
          function (err) {
            if (err) {
              return stepDone(errors.unexpectedError(err));
            }
            result.streamDeletion = { id: params.id };
            pubsub.notifications.emit(context.user.username, pubsub.USERNAME_BASED_STREAMS_CHANGED);
            stepDone();
          });
      }
    ], next);
  }

};

/**
 * Returns if an array has all elements contained in another.
 * 
 * @param {Array} a Contains element to check if they exists in b
 * @param {Array} b
 */
function arrayAIsIncludedInB (a, b) {
  return a.every(i => b.includes(i));
}
