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

const {LoggerInterface} = require('./logger-interface');
const sinon = require('sinon');

/**
 * Stub class for Caliper loggers.
 */
class LoggerStub extends LoggerInterface {
    /**
     * Initializes the new instance.
     */
    constructor() {
        super();
        this.debug = sinon.stub();
        this.info = sinon.stub();
        this.warn = sinon.stub();
        this.error = sinon.stub();
    }
}

module.exports = LoggerStub;
