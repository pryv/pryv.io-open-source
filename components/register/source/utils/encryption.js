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
/**
 * Encryption functions (wraps bcrypt functionality).
 * THIS FILE IS A COPY FROM ACTIVITY SERVER: don't modify one without the other.
 */

var bcrypt = require('bcrypt');

var envIsDevelopment = ! process.env.NODE_ENV || process.env.NODE_ENV === 'development';
var salt = bcrypt.genSaltSync(envIsDevelopment ? 1 : 10);

/**
 * Generate a hash from provided value
 * @param value: the value to be hashed
 * @param callback: callback (error, result), result being the generated hash
 */
exports.hash = function(value, callback) {
  bcrypt.hash(value, salt, callback);
};

/**
 * Synchronous hash function
 * For tests only
 * @param value: the value to be hashed
 */
exports.hashSync = function(value) {
  return bcrypt.hashSync(value, salt);
};

/**
 * @param {String} value The value to check
 * @param {String} hash The hash to check the value against
 * @param {Function} callback (error, {Boolean} result)
 */
/**
 * Check if a provided value, once hashed, matches the provided hash
 * @param value: the value to check
 * @param hash: the hash to check match
 * @param callback: function(err,res), res being 'true' if there is a match, 'false' otherwise
 */
exports.compare = function(value, hash, callback) {
  bcrypt.compare(value, hash, callback);
};
