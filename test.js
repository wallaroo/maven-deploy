/* globals describe, it, beforeEach, afterEach */
/*jshint expr: true*/
var assert = require('assert');
var sinon = require('sinon');
var extend = require('util-extend');
var proxyquire = require('proxyquire');
var fsMock = require('mock-fs');
var semver = require('semver');
var maven, fs;

var lastCmd, cmdCallback;

const GROUP_ID = 'com.dummy',
    DUMMY_REPO = {
        'id': 'dummy-repo',
        'url': 'http://mavendummyrepo.com/dummy/'
    },
    TEST_CONFIG = {
        groupId: GROUP_ID,
        repositories: [DUMMY_REPO]
    },
    TEST_PKG_JSON = {
        name: 'test-pkg',
        version: '1.0.0'
    };

var childProcessMock;

function createFakeFS () {
    var fakeFS = fsMock.fs({
        'package.json': JSON.stringify(TEST_PKG_JSON),
        'dist': {
            'js': {
                'index.js': 'console.log("test")',
            },
            'README.md': '## README\nlorum ipsum'
        }
    });
    return fakeFS;
}

function npmVersion (next) {
    var fileName = 'package.json';
    var pkg = JSON.parse(fs.readFileSync(fileName), {encoding: 'utf-8'});
    pkg.version = next;
    fs.writeFileSync(fileName, JSON.stringify(pkg), {encoding: 'utf-8'});
}

function warFileInDist () {
    return fs.readdirSync('./dist/').filter(function (fileName) {
        return /\.war$/.test(fileName);
    })[0];
}

function assertWarFileToEqual (expectedName) {
    var warFile = warFileInDist();
    assert.ok(warFile);
    assert.equal(warFile, expectedName);
}

function arrayContains (arr, value) {
    return arr.indexOf(value) !== -1;
}

describe('maven-deploy', function () {
    beforeEach(function () {
        lastCmd = undefined;
        cmdCallback = undefined;

        childProcessMock = {
            exec: sinon.spy(),
            spawn: sinon.spy(),
            fork: sinon.spy()
        };

        fs = createFakeFS();

        maven = proxyquire('./index.js', {
            'child_process': childProcessMock,
            'fs': fs,
            'fs-walk': proxyquire('fs-walk', {'fs': fs}),
            'isbinaryfile': proxyquire('isbinaryfile', {'fs': fs})
        });
    });

    afterEach(function () {
        fs = null;
        childProcessMock = null;
    });

    describe('config', function () {
        it('should throw an error if groupId is missing', function () {
            assert.throws(function () {
                maven.config({
                    repositories: [DUMMY_REPO]
                });
            });
        });
    });

    describe('package', function () {
        it('should create an archive based on defaults', function () {
            maven.config(TEST_CONFIG);
            maven.package();

            assertWarFileToEqual(TEST_PKG_JSON.name + '.war');
        });

        it('should have a fresh version number if the package version has changed after config(...)', function () {
            const EXPECTED_VERSION = '1.2.3';

            maven.config( extend({finalName: '{name}-{version}'}, TEST_CONFIG) );
            npmVersion(EXPECTED_VERSION);
            maven.package();

            assertWarFileToEqual(TEST_PKG_JSON.name + '-' + EXPECTED_VERSION + '.war');
        });
    });

    describe('install', function () {
        var execSpy;

        beforeEach(function () {
            execSpy = childProcessMock.exec;
        });

        it('should exec "mvn"', function () {
            maven.config(TEST_CONFIG);
            maven.install();
            assert.ok(execSpy.calledOnce);
            assert.ok(execSpy.calledWithMatch(/^mvn /));
        });

        it('should pass expected arguments to "mvn"', function () {
            const EXPECTED_ARGS = [
                '-B',
                'install:install-file',
                '-Dpackaging=war',
                '-Dfile=dist/' + TEST_PKG_JSON.name + '.war',
                '-DgroupId=' + GROUP_ID,
                '-DartifactId=' + TEST_PKG_JSON.name
            ];
            maven.config(TEST_CONFIG);
            maven.install();
            var cmd = childProcessMock.exec.args[0][0].split(/\s+/);

            EXPECTED_ARGS.forEach(function (EXPECTED_ARG) {
                assert.ok(arrayContains(cmd, EXPECTED_ARG), EXPECTED_ARG + ' should be part of the command: ' + cmd);
            });
            //expect(cmd).to.include.members(EXPECTED_ARGS);
        });

        it('should increase patch-version and add -SNAPSHOT to the version to follow Maven conventions', function () {
            const EXPECTED_VERSION_ARG = '-Dversion=' + semver.inc(TEST_PKG_JSON.version, 'patch') + '-SNAPSHOT';
            maven.config(TEST_CONFIG);
            maven.install();
            var cmd = childProcessMock.exec.args[0][0].split(/\s+/);

            assert.ok(arrayContains(cmd, EXPECTED_VERSION_ARG), 'cmd should contain ' + EXPECTED_VERSION_ARG +
                ', but does not.\ncmd: ' + cmd);
        });
    });

    describe('deploy', function () {
        it('should throw an error if repositories is empty', function () {
            assert.throws(function () {
                maven.config({
                    groupId: GROUP_ID
                });
                maven.deploy('dummy-repo', true);
            });

            assert.throws(function () {
                maven.config({
                    groupId: GROUP_ID,
                    repositories: []
                });
                maven.deploy('dummy-repo', true);
            });
        });
    });
});
