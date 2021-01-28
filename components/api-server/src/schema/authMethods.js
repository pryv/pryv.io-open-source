/**
 * @license
 * Copyright (c) 2020 Pryv S.A. https://pryv.com
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
 * 
 */
/**
 * JSON Schema specification of methods data for auth.
 */
const ErrorIds = require('errors/src/ErrorIds');
const ErrorMessages = require('errors/src/ErrorMessages');
const SystemStreamsSerializer = require('business/src/system-streams/serializer');

var helpers = require('./helpers'),
  object = helpers.object,
  string = helpers.string;

let registrationSchema = {
  params: object({
    username: helpers.username,
    password: helpers.string({
      minLength: 6,
      maxLength: 100
    }),
    email: helpers.email,
    appId: helpers.string({
      minLength: 6,
      maxLength: 99,
    }),
    invitationToken: string(),
    referer: helpers.string({
      nullable: true,
      minLength: 1,
      maxLength: 99,
    }),
    language: helpers.language,
  }, {
    required: ['password'],
    messages: {
      appId: {
        MIN_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidAppId],
          code: ErrorIds.InvalidAppId
        },
        MAX_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidAppId],
          code: ErrorIds.InvalidAppId
        },
        INVALID_TYPE: {
          message: ErrorMessages[ErrorIds.InvalidAppId],
          code: ErrorIds.InvalidAppId
        },
        OBJECT_MISSING_REQUIRED_PROPERTY: {
          message: ErrorMessages[ErrorIds.MissingRequiredField] + ': appId',
          code: ErrorIds.InvalidAppId
        }
      },
      username: {
        PATTERN: {
          message: ErrorMessages[ErrorIds.InvalidUsername],
          code: ErrorIds.InvalidUsername
        },
        OBJECT_MISSING_REQUIRED_PROPERTY: {
          message: ErrorMessages[ErrorIds.UsernameRequired],
          code: ErrorIds.UsernameRequired
        }
      },
      password: {
        MIN_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidPassword],
          code: ErrorIds.InvalidPassword
        },
        MAX_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidPassword],
          code: ErrorIds.InvalidPassword
        },
        INVALID_TYPE: {
          message: ErrorMessages[ErrorIds.InvalidPassword],
          code: ErrorIds.InvalidPassword
        },
        OBJECT_MISSING_REQUIRED_PROPERTY: {
          message: ErrorMessages[ErrorIds.PasswordRequired],
          code: ErrorIds.PasswordRequired
        }
      },
      email: {
        INVALID_TYPE: {
          message: ErrorMessages[ErrorIds.InvalidEmail],
          code: ErrorIds.InvalidEmail
        },
        OBJECT_MISSING_REQUIRED_PROPERTY: {
          message: ErrorMessages[ErrorIds.EmailRequired],
          code: ErrorIds.EmailRequired
        }
      },
      invitationToken: {
        INVALID_TYPE: {
          message: ErrorMessages[ErrorIds.InvalidInvitationToken],
          code: ErrorIds.InvalidInvitationToken
        }
      },
      referer: {
        MIN_LENGTH: {
          message: ErrorMessages[ErrorIds.Invalidreferer],
          code: ErrorIds.Invalidreferer
        },
        MAX_LENGTH: {
          message: ErrorMessages[ErrorIds.Invalidreferer],
          code: ErrorIds.Invalidreferer
        },
        INVALID_TYPE: {
          message: ErrorMessages[ErrorIds.Invalidreferer],
          code: ErrorIds.Invalidreferer
        }
      },
      language: {
        MAX_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidLanguage],
          code: ErrorIds.InvalidLanguage
        },
        MIN_LENGTH: {
          message: ErrorMessages[ErrorIds.InvalidLanguage],
          code: ErrorIds.InvalidLanguage
        }
      },
      additionalProperties: true
    }
  }),
  result: object({
    username: string(),
    apiEndpoint: string()
  }, {
    required: ['username'],
    additionalProperties: true
  })
};

// extend registration settings with settings from the accountStreams
registrationSchema.params = loadCustomValidationSettings(registrationSchema.params);


module.exports = {
  login: {
    params: object({
      'username': string(),
      'password': string(),
      'appId': string(),
      'origin': string()
    }, {
      required: ['username', 'password', 'appId'],
      additionalProperties: false
    }),
    result: object({
      token: string()
    }, {
      required: ['token'],
      additionalProperties: false
    })
  },

  logout: {
    params: object({})
  },

  register: registrationSchema,

  usernameCheck: {
    params: object({
      username: helpers.username,
    }, {
      required: ['username'],
      messages: {
        username: {
          PATTERN: {
            message: ErrorMessages[ErrorIds.InvalidUsername],
            code: ErrorIds.InvalidUsername
          },
          OBJECT_MISSING_REQUIRED_PROPERTY: {
            message: ErrorMessages[ErrorIds.UsernameRequired],
            code: ErrorIds.UsernameRequired
          }
        }
      },
      additionalProperties: false
    })
  },
  emailCheck: {
    params: object({
      email: helpers.email,
    }, {
      required: ['email'],
      messages: {
        email: {
          PATTERN: {
            message: ErrorMessages[ErrorIds.InvalidEmail],
            code: ErrorIds.InvalidEmail
          },
          OBJECT_MISSING_REQUIRED_PROPERTY: {
            message: ErrorMessages[ErrorIds.EmailRequired],
            code: ErrorIds.EmailRequired
          }
        }
      },
      additionalProperties: false
    })
  },
};

/**
 * Append validation settings to validation schema
 * Currently it can append required field, Regex for string validation and custom
 * validation message
 */
function loadCustomValidationSettings (validationSchema) {
  // iterate account stream settings and APPEND validation with relevant properties
  // etc additional required fields or regex validation
  const accountStreamsSettings = SystemStreamsSerializer.getFlatAccountStreamSettings()
  for (const [streamIdWithDot, value] of Object.entries(accountStreamsSettings)) {
    // if streamIdWithDot is set as required - add required validation
    let streamId = SystemStreamsSerializer.removeDotFromStreamId(streamIdWithDot);
    if (
      value?.isRequiredInValidation == true &&
      !validationSchema.required.includes(streamIdWithDot)
    ) {
      validationSchema.required.push(streamId);
      //the error message of required property by z-schema is still a hell
    }

    // if accountStream hasfield has type validation - add regex type rule
    // etc : '^(series:)?[a-z0-9-]+/[a-z0-9-]+$'
    if (
      value.regexValidation &&
      !validationSchema.properties.hasOwnProperty(streamId)
    ) {
      validationSchema.properties[streamId] = string({
        pattern: value.regexValidation
      });

      // if there is an error message and code specified, set those too
      if (
        value.regexError &&
        !validationSchema.messages.hasOwnProperty(streamId)
      ) {
        validationSchema.messages[streamId] = { PATTERN: value.regexError };
      }
    }
  }
  return validationSchema;
}