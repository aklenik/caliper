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

const colors = require('colors/safe');
const { LEVEL } = require('triple-beam');

/**
 * Winston format implementation for colorizing log message attributes.
 */
class Colorize {
    /**
     * Creates a new instance of the format.
     * @param {ColorizeOptions} options The colorization options.
     */
    constructor(options) {
        this.options = options;
    }

    /**
     * Colorize the required attributes of the log message info.
     * @param {object} info The log message info.
     * @return {object} The mutated log message info.
     */
    transform(info) {
        for (let attribute of Object.keys(info)) {
            if (info[attribute] === undefined) {
                continue;
            }

            if (this.options.shouldColorizeAttribute(attribute)) {
                this._tryToColorizeAttribute(info, attribute);
            }
        }

        return info;
    }

    /**
     * Try to colorize the given attribute with the configured color(s).
     * @param {object} info The log message info.
     * @param {string} attribute The name of the attribute.
     * @private
     */
    _tryToColorizeAttribute(info, attribute) {
        // surround the value with the style codes one by one
        for (let color of this.options.getColorsForLevel(info[LEVEL])) {
            try {
                info[attribute] = colors[color](info[attribute]);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error(`Error while colorizing log message attribute "${attribute}" with color "${color}": ${e.message}`);
            }
        }
    }
}

module.exports = Colorize;
