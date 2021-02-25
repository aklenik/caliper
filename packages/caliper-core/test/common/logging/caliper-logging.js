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

const chai = require('chai');
const should = chai.should();
const sinon = require('sinon');
const rewire = require('rewire');

const CaliperLogging = rewire('../../../lib/common/logging/caliper-logging');
const WinstonLoggerAdapter = require('../../../lib/common/logging/loggers/winston-logger-adapter');
const WinstonLoggerAdapterStub = require('../../../lib/common/logging/loggers/winston-logger-adapter-stub');

const TestModuleName = 'test';
const RootLoggerVariable = 'RootLogger';

function setLoggerModule(loggerModule) {
    CaliperLogging.__set__('WinstonLoggerAdapter', loggerModule);
}

function clearRootLogger() {
    CaliperLogging.__set__(RootLoggerVariable, undefined);
}

function getRootLogger() {
    return CaliperLogging.__get__(RootLoggerVariable);
}

describe('CaliperLogging module', () => {
    describe('createLogger function', () => {
        beforeEach(() => {
            setLoggerModule(WinstonLoggerAdapterStub);
            clearRootLogger();
        });

        afterEach(() => {
            setLoggerModule(WinstonLoggerAdapter);
            clearRootLogger();
        });

        it('should create and configure a root logger if it does not exist', () => {
            // Arrange

            // Act
            CaliperLogging.createLogger(TestModuleName);

            // Assert
            const rootLogger = getRootLogger();
            should.exist(rootLogger);
            sinon.assert.calledOnce(rootLogger.configure);
        });

        it('should not create and configure a root logger if it exists', () => {
            // Arrange
            const presetRootLogger = new WinstonLoggerAdapterStub();
            CaliperLogging.__set__(RootLoggerVariable, presetRootLogger);

            // Act
            CaliperLogging.createLogger(TestModuleName);

            // Assert
            const rootLogger = getRootLogger();
            rootLogger.should.equal(presetRootLogger);
            sinon.assert.notCalled(rootLogger.configure);
        });

        it('should create and return a module logger with the passed name', () => {
            // Arrange

            // Act
            const moduleLogger = CaliperLogging.createLogger(TestModuleName);

            // Assert
            const rootLogger = getRootLogger();
            should.exist(moduleLogger);
            sinon.assert.calledOnceWithExactly(rootLogger.createChildLogger, TestModuleName);
        });
    });
});
