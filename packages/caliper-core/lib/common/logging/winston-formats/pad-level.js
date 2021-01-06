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

const {LoggingLevels} = require('../loggers/logger-interface');

/**
 * Winston format implementation for padding log message level strings to be the same length.
 */
class PadLevel {
    /**
     * Creates a new instance of the format.
     */
    constructor() {
        this.longestLevelLength = Math.max(...Object.keys(LoggingLevels).map(level => level.length));
    }

    /**
     * Pad the level attribute of the log message info.
     * @param {object} info The log message info.
     * @return {object} The mutated log message info.
     */
    transform(info) {
        info.level = info.level.padEnd(this.longestLevelLength, ' ');
        return info;
    }
}

module.exports = PadLevel;
