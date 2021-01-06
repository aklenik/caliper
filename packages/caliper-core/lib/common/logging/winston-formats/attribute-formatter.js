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

const attributeRegex = /%attribute%/gi;

/**
 * Winston format implementation for formatting log message attributes.
 */
class AttributeFormatter {
    /**
     * Creates a new instance of the format.
     * @param {AttributeFormatterOptions} options Options for the attribute formats.
     */
    constructor(options) {
        this.options = options;
    }

    /**
     * Format the required attributes of the log message info.
     * @param {object} info The log message info.
     * @return {object} The mutated log message info.
     */
    transform(info) {
        for (let attribute of Object.keys(info)) {
            if (!this.options.hasFormatStringForAttribute(attribute)) {
                continue;
            }

            this._formatAttribute(info, attribute);
        }

        return info;
    }

    /**
     * Format the given attribute of the log info.
     * @param {object} info The log info object.
     * @param {string} attribute The name of the attribute.
     * @private
     */
    _formatAttribute(info, attribute) {
        if (typeof info[attribute] !== 'string') {
            info[attribute] = JSON.stringify(info[attribute]);
        }

        const formatString = this.options.getFormatStringForAttribute(attribute);
        info[attribute] = formatString.replace(attributeRegex, info[attribute]);
    }
}

module.exports = AttributeFormatter;
