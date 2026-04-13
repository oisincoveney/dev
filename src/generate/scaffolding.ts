/**
 * Scaffolds example files into a new project:
 * - Contract-driven module example (src/modules/example/index.ts etc.)
 * - Property-based testing example (prop example test)
 * - Observability scaffolding (logger init)
 */

import type { DevConfig } from '../config.js'

export interface ScaffoldedFile {
  path: string
  content: string
}

export function generateProjectScaffolding(config: DevConfig): ScaffoldedFile[] {
  const files: ScaffoldedFile[] = []

  if (config.contractDriven) {
    files.push(...contractDrivenExample(config))
  }

  files.push(...propertyBasedTestingExample(config))
  files.push(...observabilityScaffolding(config))

  if (
    (config.variant === 'ts-frontend' || config.variant === 'ts-fullstack') &&
    config.commands.e2e
  ) {
    files.push(...playwrightScaffolding(config))
  }

  return files
}

function contractDrivenExample(config: DevConfig): ScaffoldedFile[] {
  switch (config.language) {
    case 'typescript':
      return [
        {
          path: 'src/modules/example/index.ts',
          content: `// Public interface — other modules may ONLY import from this file.
// Internal implementation lives in ./example.ts, contract in ./example.contract.ts.
export type { ExampleId, ExampleRecord } from './example.contract.js'
export { createExample, findExample } from './example.js'
`,
        },
        {
          path: 'src/modules/example/example.contract.ts',
          content: `// Contract: types, invariants, pre/post-conditions.
// This file is the source of truth for what this module promises.

/** Branded ID type — prevents mixing with other string IDs. */
export type ExampleId = string & { readonly __brand: 'ExampleId' }

/** An example record as exposed to consumers. */
export interface ExampleRecord {
  readonly id: ExampleId
  readonly name: string
  readonly createdAt: Date
}

/**
 * Invariants:
 * - id is non-empty and unique within the store
 * - name is 1..128 characters after trimming
 * - createdAt is not in the future
 */
`,
        },
        {
          path: 'src/modules/example/example.ts',
          content: `import type { ExampleId, ExampleRecord } from './example.contract.js'

const store = new Map<ExampleId, ExampleRecord>()

/**
 * Create a new example record.
 * @precondition name.trim().length in [1, 128]
 * @postcondition returned record is retrievable via findExample(result.id)
 */
export function createExample(name: string): ExampleRecord {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 128) {
    throw new Error('name must be 1..128 characters')
  }
  const id = crypto.randomUUID() as ExampleId
  const record: ExampleRecord = { id, name: trimmed, createdAt: new Date() }
  store.set(id, record)
  return record
}

/** Find an example by id. Returns null if not found. */
export function findExample(id: ExampleId): ExampleRecord | null {
  return store.get(id) ?? null
}
`,
        },
        {
          path: 'src/modules/example/example.test.ts',
          content: `import { describe, expect, it } from 'vitest'
import { createExample, findExample } from './index.js'

describe('example module contract', () => {
  it('creates and retrieves a record', () => {
    const record = createExample('hello')
    expect(findExample(record.id)).toEqual(record)
  })

  it('rejects empty names', () => {
    expect(() => createExample('')).toThrow()
  })

  it('rejects names longer than 128 characters', () => {
    expect(() => createExample('x'.repeat(129))).toThrow()
  })
})
`,
        },
      ]
    case 'rust':
      return [
        {
          path: 'src/example/mod.rs',
          content: `//! Example module with a contract-driven API.
//!
//! # Contract
//! - \`Example::new\` returns \`Err\` if the name is empty or > 128 chars.
//! - \`Example::name\` always returns the trimmed, validated name.
//!
//! Callers use only the public \`pub\` items below. Internals are \`pub(crate)\`.

mod internal;

pub use internal::Example;
pub use internal::ExampleError;
`,
        },
        {
          path: 'src/example/internal.rs',
          content: `use std::time::SystemTime;

#[derive(Debug, thiserror::Error)]
pub enum ExampleError {
    #[error("name must be 1..128 characters")]
    InvalidName,
}

#[derive(Debug, Clone)]
pub struct Example {
    name: String,
    created_at: SystemTime,
}

impl Example {
    /// Create a new Example.
    ///
    /// # Errors
    /// Returns \`ExampleError::InvalidName\` if the trimmed name is empty or > 128 chars.
    pub fn new(name: &str) -> Result<Self, ExampleError> {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 128 {
            return Err(ExampleError::InvalidName);
        }
        Ok(Self {
            name: trimmed.to_string(),
            created_at: SystemTime::now(),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn created_at(&self) -> SystemTime {
        self.created_at
    }
}
`,
        },
      ]
    case 'go':
      return [
        {
          path: 'example/example.go',
          content: `// Package example demonstrates a contract-driven package.
//
// Callers use only the exported identifiers below. Unexported types and
// functions are internal and may change without notice.
package example

import (
	"errors"
	"strings"
	"time"
)

// ErrInvalidName is returned when the given name fails validation.
var ErrInvalidName = errors.New("name must be 1..128 characters")

// Record is the public contract type.
type Record struct {
	Name      string
	CreatedAt time.Time
}

// New constructs a Record after validating the name.
//
// Precondition: name, trimmed, has 1..128 characters.
// Postcondition: returned record has the trimmed name and CreatedAt set.
func New(name string) (Record, error) {
	trimmed := strings.TrimSpace(name)
	if len(trimmed) < 1 || len(trimmed) > 128 {
		return Record{}, ErrInvalidName
	}
	return Record{Name: trimmed, CreatedAt: time.Now()}, nil
}
`,
        },
        {
          path: 'example/example_test.go',
          content: `package example

import (
	"errors"
	"testing"
)

func TestNewAcceptsValidName(t *testing.T) {
	r, err := New("hello")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Name != "hello" {
		t.Errorf("got %q, want %q", r.Name, "hello")
	}
}

func TestNewRejectsEmpty(t *testing.T) {
	_, err := New("")
	if !errors.Is(err, ErrInvalidName) {
		t.Errorf("got %v, want ErrInvalidName", err)
	}
}
`,
        },
      ]
  }
}

function propertyBasedTestingExample(config: DevConfig): ScaffoldedFile[] {
  switch (config.language) {
    case 'typescript':
      return [
        {
          path: 'src/__tests__/example.pbt.test.ts',
          content: `import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'

// Property-based test example.
// fast-check generates hundreds of random inputs to find edge cases.
// Replace with properties relevant to your own code.

describe('reverse reverse is identity', () => {
  test.prop([fc.array(fc.integer())])('reverse twice returns original', (arr) => {
    expect([...arr].reverse().reverse()).toEqual(arr)
  })
})
`,
        },
      ]
    case 'rust':
      return [
        {
          path: 'tests/property_example.rs',
          content: `//! Property-based test example using proptest.
//! Generates random inputs to find edge cases unit tests miss.

use proptest::prelude::*;

proptest! {
    #[test]
    fn reverse_reverse_is_identity(xs in prop::collection::vec(any::<i32>(), 0..100)) {
        let mut reversed = xs.clone();
        reversed.reverse();
        reversed.reverse();
        prop_assert_eq!(reversed, xs);
    }
}
`,
        },
      ]
    case 'go':
      return [
        {
          path: 'property_example_test.go',
          content: `package main

import (
	"testing"

	"pgregory.net/rapid"
)

// Property-based test example using rapid.
// Generates random inputs to find edge cases unit tests miss.

func TestReverseReverseIsIdentity(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
		ys := make([]int, len(xs))
		copy(ys, xs)
		reverse(ys)
		reverse(ys)
		for i, v := range ys {
			if v != xs[i] {
				t.Fatalf("mismatch at %d: %d != %d", i, v, xs[i])
			}
		}
	})
}

func reverse(s []int) {
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
}
`,
        },
      ]
  }
}

function playwrightScaffolding(config: DevConfig): ScaffoldedFile[] {
  const baseUrl =
    config.commands.dev.includes('vp dev') ? 'http://localhost:5173' : 'http://localhost:3000'

  return [
    {
      path: 'playwright.config.ts',
      content: `import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: '${baseUrl}',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: '${config.commands.dev}',
    url: '${baseUrl}',
    reuseExistingServer: !process.env.CI,
  },
})
`,
    },
    {
      path: 'e2e/example.spec.ts',
      content: `import { expect, test } from '@playwright/test'

// Example browser test. Replace with real user-flow tests.
// Browser tests verify behaviour at the UI layer — unit tests cover logic.
// Rule: one spec file per feature or user journey.

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/.+/)
})
`,
    },
  ]
}

function observabilityScaffolding(config: DevConfig): ScaffoldedFile[] {
  switch (config.language) {
    case 'typescript':
      return [
        {
          path: 'src/logger.ts',
          content: `// Structured logging via pino.
// Use this logger everywhere — never console.log / console.error in production code.
// Include context fields (user_id, request_id, trace_id) on every log.
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})
`,
        },
      ]
    case 'rust':
      return [
        {
          path: 'src/logging.rs',
          content: `//! Structured logging via tracing.
//! Call \`logging::init()\` at program start. Use \`tracing::info!\` etc. throughout.

use tracing_subscriber::{EnvFilter, fmt};

pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .json()
        .init();
}
`,
        },
      ]
    case 'go':
      return [
        {
          path: 'internal/logging/logging.go',
          content: `// Package logging provides a structured slog logger.
// Use this instead of fmt.Println. Include context fields on every call.
package logging

import (
	"log/slog"
	"os"
)

func New() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}
`,
        },
      ]
  }
}
