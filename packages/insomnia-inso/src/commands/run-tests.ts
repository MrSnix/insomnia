// @flow
import { generate, runTestsCli } from 'insomnia-testing';
import type { GlobalOptions } from '../get-options';
import { loadDb } from '../db';
import type { UnitTest, UnitTestSuite } from '../db/models/types';
import logger, { noConsoleLog } from '../logger';
import { loadTestSuites, promptTestSuites } from '../db/models/unit-test-suite';
import { loadEnvironment, promptEnvironment } from '../db/models/environment';

export const TestReporterEnum = {
  dot: 'dot',
  list: 'list',
  spec: 'spec',
  min: 'min',
  progress: 'progress',
};

export type RunTestsOptions = GlobalOptions & {
  env?: string,
  reporter: $Keys<typeof TestReporterEnum>,
  bail?: boolean,
  keepFile?: boolean,
  testNamePattern?: string,
};

function isExternalReporter({ reporter }: RunTestsOptions): boolean {
  return reporter && !TestReporterEnum[reporter];
}

function getTestSuite(dbSuite: UnitTestSuite, dbTests: Array<UnitTest>) {
  return {
    name: dbSuite.name,
    tests: dbTests.map(({ name, code, requestId }) => ({
      name,
      code,
      defaultRequestId: requestId,
    })),
  };
}

async function getEnvironments(db, ci, suites, env) {
  const workspaceId = suites[0].parentId;
  return env
    ? loadEnvironment(db, workspaceId, env)
    : await promptEnvironment(db, !!ci, workspaceId);
}

async function getTestFileContent(db, suites) {
  return await generate(
    suites.map(suite =>
      getTestSuite(
        suite,
        db.UnitTest.filter(t => t.parentId === suite._id),
      ),
    ),
  );
}

// Identifier can be the id or name of a workspace, apiSpec, or unit test suite
export async function runInsomniaTests(
  identifier?: string,
  options: RunTestsOptions,
): Promise<boolean> {
  const { reporter, ci, bail, keepFile, testNamePattern, env } = options;
  // Loading database instance
  const db = await loadDb(options);

  // Check if any provider has been provided (Yeah, comedy king)
  const isExternal = isExternalReporter(options);

  // Find suites
  const suites = identifier ? loadTestSuites(db, identifier) : await promptTestSuites(db, !!ci);

  if (!suites.length) {
    logger.fatal('No test suites found; cannot run tests.');
    return false;
  }

  // Find env
  const environment = await getEnvironments(db, ci, suites, env);

  if (!environment) {
    logger.fatal('No environment identified; cannot run tests without a valid environment.');
    return false;
  }

  // Generate test file
  const testFiles = await getTestFileContent(db, suites);

  // Load lazily when needed, otherwise this require slows down the entire CLI.
  const { getSendRequestCallbackMemDb } = require('insomnia-send-request');
  const sendRequest = await getSendRequestCallbackMemDb(environment._id, db);

  const config = {
    reporter,
    bail,
    keepFile,
    sendRequest,
    testFilter: testNamePattern,
  };

  return isExternal
    ? runTestsCli(testFiles, config)?.catch(e => {
        if (e.toString().includes('invalid reporter')) {
          logger.fatal(`The following reporter \`${reporter}\` was not found!`);
        } else {
          logger.fatal(`An unknown error occurred: ${e}`);
        }
      })
    : await noConsoleLog(() => runTestsCli(testFiles, config));
}
