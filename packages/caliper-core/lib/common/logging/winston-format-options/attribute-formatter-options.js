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

const Config = require('../../config/config-util');

const DefaultAttributeFormat = undefined;

/**
 * Class representing the options for the colorize winston format.
 */
class AttributeFormatterOptions {
    /**
     * Initializes a new instance.
     */
    constructor() {
        this.attributeFormats = {
            timestamp: DefaultAttributeFormat,
            label: DefaultAttributeFormat,
            level: DefaultAttributeFormat,
            module: DefaultAttributeFormat,
            message: DefaultAttributeFormat,
            metadata: DefaultAttributeFormat
        };
    }

    /**
     * Indicates whether formatting is available for the given attribute.
     * @param {string} attributeName The attribute name.
     * @return {boolean} True, if formatting is available. Otherwise false.
     */
    hasFormatStringForAttribute(attributeName) {
        return this.attributeFormats[attributeName] !== undefined;
    }

    /**
     * Get the format string for the given attribute
     * @param {string} attributeName The attribute name.
     * @return {string} The attribute format string.
     */
    getFormatStringForAttribute(attributeName) {
        return this.attributeFormats[attributeName];
    }

    /**
     * Set the format string for the "timestamp" attribute.
     * @param {string} formatString The format string.
     */
    setTimestampFormatString(formatString) {
        this.attributeFormats.timestamp = formatString;
    }

    /**
     * Set the format string for the "label" attribute.
     * @param {string} formatString The format string.
     */
    setLabelFormatString(formatString) {
        this.attributeFormats.label = formatString;
    }

    /**
     * Set the format string for the "level" attribute.
     * @param {string} formatString The format string.
     */
    setLevelFormatString(formatString) {
        this.attributeFormats.level = formatString;
    }

    /**
     * Set the format string for the "module" attribute.
     * @param {string} formatString The format string.
     */
    setModuleFormatString(formatString) {
        this.attributeFormats.module = formatString;
    }

    /**
     * Set the format string for the "message" attribute.
     * @param {string} formatString The format string.
     */
    setMessageFormatString(formatString) {
        this.attributeFormats.message = formatString;
    }

    /**
     * Set the format string for the "metadata" attribute.
     * @param {string} formatString The format string.
     */
    setMetadataFormatString(formatString) {
        this.attributeFormats.metadata = formatString;
    }

    /**
     * Creates a new instance based on the Caliper configuration.
     * @return {AttributeFormatterOptions} The new instance.
     */
    static loadFromConfiguration() {
        const keys = Config.keys.Logging.Formats.AttributeFormat;
        const options = new AttributeFormatterOptions();

        options.setTimestampFormatString(Config.get(keys.Timestamp));
        options.setLabelFormatString(Config.get(keys.Label));
        options.setLevelFormatString(Config.get(keys.Level));
        options.setModuleFormatString(Config.get(keys.Module));
        options.setMessageFormatString(Config.get(keys.Message));
        options.setMetadataFormatString(Config.get(keys.Metadata));

        return options;
    }
}

module.exports = AttributeFormatterOptions;
