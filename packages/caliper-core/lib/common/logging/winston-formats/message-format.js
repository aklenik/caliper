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

const AttributeReplacers = {
    timestamp: /%timestamp%/gi,
    level: /%level%/gi,
    label: /%label%/gi,
    module: /%module%/gi,
    message: /%message%/gi,
    metadata: /%metadata%/gi
};

const Attributes = Object.keys(AttributeReplacers);

/**
 * Class representing the final formatting of log messages.
 */
class MessageFormat {
    /**
     * Creates a new instance of the format.
     * @param {string} messageTemplate The message template string.
     */
    constructor(messageTemplate) {
        this.messageTemplate = messageTemplate;
    }

    /**
     * Assemble the attributes of the log message info into the final message.
     * @param {object} info The log message info.
     * @return {string} The final log message.
     */
    transform(info) {
        let finalMessage = `${this.messageTemplate}`;
        for (const attribute of Attributes) {
            finalMessage = finalMessage.replace(AttributeReplacers[attribute], info[attribute] || '');
        }

        return finalMessage;
    }
}

module.exports = MessageFormat;
