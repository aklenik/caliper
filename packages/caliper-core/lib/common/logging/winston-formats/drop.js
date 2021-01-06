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

const { LEVEL } = require('triple-beam');
const { LoggingLevels } = require('../loggers/logger-interface');

/**
 * Winston format implementation for dropping log messages above a certain severity threshold.
 */
class Drop {
    /**
     * Creates a new instance of the format.
     * @param {number} maximumLoggingLevel The maximum logging level to keep.
     */
    constructor(maximumLoggingLevel) {
        this.maximumLoggingLevel = maximumLoggingLevel;
    }

    /**
     * Filter the log message info based on its level.
     * @param {object} info The log message info.
     * @return {object|boolean} The mutated log message info.
     */
    transform(info) {
        return LoggingLevels[info[LEVEL]] > this.maximumLoggingLevel ? false : info;
    }
}

module.exports = Drop;
