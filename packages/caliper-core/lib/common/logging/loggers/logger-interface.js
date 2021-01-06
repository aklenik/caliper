/*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

'use strict';

/**
 * Specifies the available logging levels and their numeric representation.
 * The severity ordering conforms to RFC5424:
 *      severity of all levels is assumed to be numerically ascending from most important to least important.
 * @type {{warn: number, debug: number, error: number, info: number}}
 */
const LoggingLevels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

/**
 * Common interface for logger implementations.
 */
class LoggerInterface {

    /**
     * Log a debug level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    debug(message, ...metadata) {
        this._throwNotImplementedError('debug');
    }

    /**
     * Log an info level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    info(message, ...metadata) {
        this._throwNotImplementedError('info');
    }

    /**
     * Log a warning level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    warn(message, ...metadata) {
        this._throwNotImplementedError('warn');
    }

    /**
     * Log an error level message with additional metadata.
     * @param {string} message The message to log.
     * @param {object} metadata The metadata to append to the message.
     */
    error(message, ...metadata) {
        this._throwNotImplementedError('error');
    }

    /**
     * Throw an error for a function that is not implemented.
     * @param {string} functionName The name of the function.
     * @private
     */
    _throwNotImplementedError(functionName) {
        throw new Error(`Function "${functionName}" is not implemented`);
    }
}

module.exports.LoggingLevels = LoggingLevels;
module.exports.LoggerInterface = LoggerInterface;
