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

const WinstonLoggerAdapter = require('./loggers/winston-logger-adapter');

/**
 * Singleton class for creating Winston-based Caliper loggers.
 */
class CaliperLogging {
    /**
     * Create a module-scoped Caliper logger.
     * @param {string} moduleName The name of the module.
     * @return {LoggerInterface} The module logger.
     */
    createModuleLogger(moduleName) {
        if (!this.rootWinstonLogger) {
            this.rootWinstonLogger = new WinstonLoggerAdapter();
            this.rootWinstonLogger.configureWinstonLogger();
        }

        return this.rootWinstonLogger.createChildWinstonLogger(moduleName);
    }
}

// singleton instance using Node.JS module caching
module.exports = new CaliperLogging();
