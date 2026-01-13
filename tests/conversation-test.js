const path = require('path');
const fs = require('fs');

// Mock logger
const mockLogger = {
  info: (msg, data) => console.log(`  [INFO] ${msg}`, data ? JSON.stringify(data).substring(0, 80) : ''),
  debug: () => {},
  warn: console.warn,
  error: console.error,
  command: () => {}
};

// Mock eventBus
const mockEventBus = {
  emitEvent: () => {},
  subscribe: () => {},
  constructor: {
    Events: {
      SESSION_STARTED: 'SESSION_STARTED',
      SESSION_OUTPUT: 'SESSION_OUTPUT',
      SESSION_COMPLETED: 'SESSION_COMPLETED',
      SESSION_TERMINATED: 'SESSION_TERMINATED',
      SESSION_ERROR: 'SESSION_ERROR'
    }
  }
};

// Setup mocks before requiring modules
require.cache[require.resolve('../src/utils/logger')] = { exports: mockLogger };
require.cache[require.resolve('../src/core/EventBus')] = { exports: mockEventBus };

const CmdExecutor = require('../src/claude/CmdExecutor');

// Test configuration
const TEST_DIR = path.join(__dirname, 'test-workspace');
const SESSION_ID = 'conv-test-' + Date.now();

// Test scenarios simulating user conversation
const conversationSteps = [
  {
    name: 'Greeting',
    command: 'hi, how are you?',
    validate: (output) => output.length > 0
  },
  {
    name: 'Create folder',
    command: 'create a folder called "my-project"',
    validate: (output) => output.length > 0,
    checkFs: () => fs.existsSync(path.join(TEST_DIR, 'my-project'))
  },
  {
    name: 'Create file',
    command: 'create a file called hello.txt inside my-project folder with content "Hello World"',
    validate: (output) => output.length > 0,
    checkFs: () => fs.existsSync(path.join(TEST_DIR, 'my-project', 'hello.txt'))
  },
  {
    name: 'Read file',
    command: 'what is the content of my-project/hello.txt?',
    validate: (output) => output.toLowerCase().includes('hello')
  },
  {
    name: 'Ask about context',
    command: 'what files did we create so far in this conversation?',
    validate: (output) => output.toLowerCase().includes('hello') || output.toLowerCase().includes('my-project')
  },
  {
    name: 'Create another file',
    command: 'create a file called config.json in my-project with content { "name": "test", "version": "1.0.0" }',
    validate: (output) => output.length > 0,
    checkFs: () => fs.existsSync(path.join(TEST_DIR, 'my-project', 'config.json'))
  },
  {
    name: 'List files',
    command: 'list all files in my-project folder',
    validate: (output) => output.length > 0
  },
  {
    name: 'Modify file',
    command: 'add a new line "Goodbye World" to hello.txt',
    validate: (output) => output.length > 0
  },
  {
    name: 'Verify modification',
    command: 'show me the current content of my-project/hello.txt',
    validate: (output) => output.length > 0
  },
  {
    name: 'Summary request',
    command: 'give me a summary of everything we did in this conversation',
    validate: (output) => output.length > 50
  }
];

// Utility functions
function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main test runner
async function runConversationTest() {
  console.log('='.repeat(60));
  console.log('CONVERSATION TEST - Simulating user interactions');
  console.log('='.repeat(60));
  console.log(`\nTest directory: ${TEST_DIR}`);
  console.log(`Session ID: ${SESSION_ID}\n`);

  // Setup
  cleanupTestDir();

  let passed = 0;
  let failed = 0;
  const results = [];

  try {
    // Create session
    console.log('Creating session...\n');
    await CmdExecutor.createSession(SESSION_ID, TEST_DIR);

    // Run each conversation step
    for (let i = 0; i < conversationSteps.length; i++) {
      const step = conversationSteps[i];
      console.log(`\n[${i + 1}/${conversationSteps.length}] ${step.name}`);
      console.log(`  Command: "${step.command.substring(0, 50)}${step.command.length > 50 ? '...' : ''}"`);

      try {
        const startTime = Date.now();
        const result = await CmdExecutor.sendCommand(SESSION_ID, step.command);
        const duration = Date.now() - startTime;

        const outputPreview = result.output?.substring(0, 150).replace(/\n/g, ' ') || '(no output)';
        console.log(`  Output: ${outputPreview}${result.output?.length > 150 ? '...' : ''}`);
        console.log(`  Duration: ${duration}ms, Exit code: ${result.exitCode}`);

        // Validate output
        const outputValid = step.validate(result.output || '');

        // Check filesystem if required
        let fsValid = true;
        if (step.checkFs) {
          await sleep(500); // Give filesystem time to sync
          fsValid = step.checkFs();
          console.log(`  Filesystem check: ${fsValid ? 'PASS' : 'FAIL'}`);
        }

        if (result.success && outputValid && fsValid) {
          console.log(`  Result: ✓ PASS`);
          passed++;
          results.push({ step: step.name, status: 'PASS', duration });
        } else {
          console.log(`  Result: ✗ FAIL (success=${result.success}, outputValid=${outputValid}, fsValid=${fsValid})`);
          failed++;
          results.push({ step: step.name, status: 'FAIL', duration, reason: 'Validation failed' });
        }

      } catch (err) {
        console.log(`  Result: ✗ ERROR - ${err.message}`);
        failed++;
        results.push({ step: step.name, status: 'ERROR', reason: err.message });
      }

      // Small delay between commands
      await sleep(1000);
    }

  } catch (err) {
    console.error('\nTest setup failed:', err.message);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('\n\nCleaning up...');
    await CmdExecutor.terminateSession(SESSION_ID);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nTotal steps: ${conversationSteps.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${Math.round(passed / conversationSteps.length * 100)}%`);

  console.log('\nDetailed results:');
  results.forEach((r, i) => {
    const status = r.status === 'PASS' ? '✓' : '✗';
    const extra = r.duration ? ` (${r.duration}ms)` : '';
    console.log(`  ${i + 1}. ${status} ${r.step}${extra}${r.reason ? ' - ' + r.reason : ''}`);
  });

  // Cleanup test directory
  console.log('\nRemoving test workspace...');
  cleanupTestDir();
  fs.rmdirSync(TEST_DIR);

  console.log('\n' + '='.repeat(60));
  if (failed === 0) {
    console.log('ALL TESTS PASSED');
    process.exit(0);
  } else {
    console.log(`${failed} TEST(S) FAILED`);
    process.exit(1);
  }
}

// Run
runConversationTest().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
