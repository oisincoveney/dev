import { describe, it, expect } from 'vitest'
import { checkContent, checkFilePath, checkStoreNaming, runAllChecks } from '../rules'

// Helper: check that a specific rule fires
function expectViolation(content: string, ruleNum: number, filePath = 'test.tsx') {
  const result = checkContent(content, filePath)
  const match = result.violations.find(v => v.rule === ruleNum)
  expect(match, `Expected violation for rule ${ruleNum} but none found.\nContent: ${content}`).toBeDefined()
  return match!
}

function expectNoViolation(content: string, ruleNum: number, filePath = 'test.tsx') {
  const result = checkContent(content, filePath)
  const match = result.violations.find(v => v.rule === ruleNum)
  expect(match, `Expected no violation for rule ${ruleNum} but found: ${match?.message}\nContent: ${content}`).toBeUndefined()
}

function expectWarning(content: string, ruleNum: number, filePath = 'test.tsx') {
  const result = checkContent(content, filePath)
  const match = result.warnings.find(w => w.rule === ruleNum)
  expect(match, `Expected warning for rule ${ruleNum} but none found.\nContent: ${content}`).toBeDefined()
  return match!
}

function expectNoWarning(content: string, ruleNum: number, filePath = 'test.tsx') {
  const result = checkContent(content, filePath)
  const match = result.warnings.find(w => w.rule === ruleNum)
  expect(match, `Expected no warning for rule ${ruleNum} but found: ${match?.message}`).toBeUndefined()
}

// ─── Rule 1: No `any` type ──────────────────────────────────────────────────

describe('Rule 1: No any type', () => {
  it('catches : any', () => {
    expectViolation('const x: any = 5', 1)
  })

  it('catches <any>', () => {
    expectViolation('const x = foo<any>()', 1)
  })

  it('catches as any', () => {
    expectViolation('const x = foo as any', 1)
  })

  it('allows unknown', () => {
    expectNoViolation('const x: unknown = 5', 1)
  })

  it('ignores "any" in string literals', () => {
    expectNoViolation('const msg = "any value is fine"', 1)
  })

  it('ignores comments', () => {
    expectNoViolation('// const x: any = bad', 1)
  })
})

// ─── Rule 2: No type assertions without comment ─────────────────────────────

describe('Rule 2: No type assertions without comment', () => {
  it('catches as Type without comment', () => {
    expectViolation('const x = foo as Bar', 2)
  })

  it('allows as Type with inline comment', () => {
    expectNoViolation('const x = foo as Bar // safe: validated above', 2)
  })

  it('ignores as lowercase (not a type assertion)', () => {
    expectNoViolation('import { foo as bar } from "baz"', 2)
  })
})

// ─── Rule 3: No non-null assertions ─────────────────────────────────────────

describe('Rule 3: No non-null assertions', () => {
  it('catches foo!.bar', () => {
    expectViolation('const x = foo!.bar', 3)
  })

  it('catches array[0]!.prop', () => {
    expectViolation('const x = items[0]!.name', 3)
  })

  it('allows !==', () => {
    expectNoViolation('if (x !== null)', 3)
  })

  it('allows !=', () => {
    expectNoViolation('if (x != null)', 3)
  })

  it('allows boolean negation', () => {
    expectNoViolation('if (!isReady) return', 3)
  })
})

// ─── Rule 4: No @ts-ignore ──────────────────────────────────────────────────

describe('Rule 4: No @ts-ignore', () => {
  it('catches @ts-ignore', () => {
    expectViolation('// @ts-ignore', 4)
  })

  it('catches @ts-expect-error', () => {
    expectViolation('// @ts-expect-error', 4)
  })
})

// ─── Rule 7: Zod-validated env ──────────────────────────────────────────────

describe('Rule 7: Zod-validated env', () => {
  it('catches process.env.X', () => {
    expectViolation('const url = process.env.API_URL', 7)
  })

  it('catches import.meta.env.X', () => {
    expectViolation('const mode = import.meta.env.MODE', 7)
  })

  it('allows in env schema files', () => {
    expectNoViolation('const url = process.env.API_URL', 7, 'config/env.ts')
  })

  it('allows in env.schema files', () => {
    expectNoViolation('const url = process.env.API_URL', 7, 'env.schema.ts')
  })
})

// ─── Rule 9: No class components ────────────────────────────────────────────

describe('Rule 9: No class components', () => {
  it('catches class extends Component', () => {
    expectViolation('class MyApp extends Component {', 9)
  })

  it('catches class extends React.Component', () => {
    expectViolation('class MyApp extends React.Component {', 9)
  })

  it('catches class extends PureComponent', () => {
    expectViolation('class MyApp extends PureComponent {', 9)
  })

  it('allows regular classes', () => {
    expectNoViolation('class MyService {', 9)
  })
})

// ─── Rule 14: No createContext ──────────────────────────────────────────────

describe('Rule 14: No createContext', () => {
  it('catches createContext()', () => {
    expectViolation('const Ctx = createContext(null)', 14)
  })

  it('catches createContext<Type>', () => {
    expectViolation('const Ctx = createContext<string>()', 14)
  })
})

// ─── Rule 15: useState warning ──────────────────────────────────────────────

describe('Rule 15: useState warning', () => {
  it('warns on useState', () => {
    expectWarning('const [open, setOpen] = useState(false)', 15)
  })
})

// ─── Rule 16: useRef warning ────────────────────────────────────────────────

describe('Rule 16: useRef warning', () => {
  it('warns on non-DOM useRef', () => {
    expectWarning('const count = useRef(0)', 16)
  })

  it('does not warn on HTMLElement ref', () => {
    expectNoWarning('const ref = useRef<HTMLDivElement>(null)', 16)
  })
})

// ─── Rule 27: Max 300 lines ─────────────────────────────────────────────────

describe('Rule 27: Max 300 lines', () => {
  it('catches files over 300 lines', () => {
    const content = Array(301).fill('const x = 1').join('\n')
    expectViolation(content, 27)
  })

  it('allows files at 300 lines', () => {
    const content = Array(300).fill('const x = 1').join('\n')
    expectNoViolation(content, 27)
  })
})

// ─── Rule 31: No arbitrary Tailwind ─────────────────────────────────────────

describe('Rule 31: No arbitrary Tailwind values', () => {
  it('catches w-[347px] in className', () => {
    expectViolation('className="w-[347px]"', 31)
  })

  it('catches h-[calc(100%-20px)]', () => {
    expectViolation('className="h-[calc(100%-20px)]"', 31)
  })

  it('allows standard Tailwind classes', () => {
    expectNoViolation('className="w-full h-screen p-4"', 31)
  })
})

// ─── Rule 32: No inline styles ──────────────────────────────────────────────

describe('Rule 32: No inline styles', () => {
  it('catches style={{ }}', () => {
    expectViolation('style={{ color: "red" }}', 32)
  })

  it('allows className', () => {
    expectNoViolation('className="text-lg"', 32)
  })
})

// ─── Rule 33: No className concatenation ────────────────────────────────────

describe('Rule 33: No className concatenation', () => {
  it('catches className with +', () => {
    expectViolation('className={"foo" + bar}', 33)
  })

  it('allows cn()', () => {
    expectNoViolation('className={cn("foo", bar)}', 33)
  })
})

// ─── Rule 34: No color-specific Tailwind ────────────────────────────────────

describe('Rule 34: No color-specific Tailwind', () => {
  it('catches bg-blue-500', () => {
    expectViolation('className="bg-blue-500"', 34)
  })

  it('catches text-red-600', () => {
    expectViolation('className="text-red-600"', 34)
  })

  it('allows theme classes', () => {
    expectNoViolation('className="bg-primary text-foreground"', 34)
  })
})

// ─── Rule 38: No <img> for SVG icons ────────────────────────────────────────

describe('Rule 38: No img for SVG icons', () => {
  it('catches <img src="icon.svg">', () => {
    expectViolation('<img src="/icons/close.svg" />', 38)
  })

  it('allows <img> for non-SVG', () => {
    expectNoViolation('<img src="/photos/hero.jpg" />', 38)
  })
})

// ─── Rule 40: No animation libraries ────────────────────────────────────────

describe('Rule 40: No animation libraries', () => {
  it('catches framer-motion import', () => {
    expectViolation('import { motion } from "framer-motion"', 40)
  })

  it('catches react-spring import', () => {
    expectViolation('import { useSpring } from "react-spring"', 40)
  })

  it('catches gsap import', () => {
    expectViolation('import gsap from "gsap"', 40)
  })
})

// ─── Rule 41: No arbitrary z-index ──────────────────────────────────────────

describe('Rule 41: No arbitrary z-index', () => {
  it('catches z-[100]', () => {
    expectViolation('className="z-[100]"', 41)
  })

  it('catches zIndex in style', () => {
    expectViolation('zIndex: 9999', 41)
  })

  it('allows z-50', () => {
    expectNoViolation('className="z-50"', 41)
  })
})

// ─── Rule 42: No empty divs ────────────────────────────────────────────────

describe('Rule 42: No empty divs', () => {
  it('catches <div />', () => {
    expectViolation('<div />', 42)
  })

  it('catches <div></div>', () => {
    expectViolation('<div></div>', 42)
  })

  it('allows div with content', () => {
    expectNoViolation('<div>content</div>', 42)
  })
})

// ─── Rule 47: No nested ternaries ───────────────────────────────────────────

describe('Rule 47: No nested ternaries', () => {
  it('catches nested ternary', () => {
    expectViolation('const x = a ? b ? c : d : e', 47)
  })

  it('allows single ternary', () => {
    expectNoViolation('const x = a ? b : c', 47)
  })
})

// ─── Rule 49: No export default ─────────────────────────────────────────────

describe('Rule 49: No export default', () => {
  it('catches export default function', () => {
    expectViolation('export default function App() {}', 49)
  })

  it('catches export default class', () => {
    expectViolation('export default class Foo {}', 49)
  })

  it('allows named export', () => {
    expectNoViolation('export function App() {}', 49)
  })
})

// ─── Rule 50: No console.log ────────────────────────────────────────────────

describe('Rule 50: No console.log', () => {
  it('catches console.log', () => {
    expectViolation('console.log("debug")', 50)
  })

  it('allows console.warn', () => {
    expectNoViolation('console.warn("warning")', 50)
  })

  it('allows console.error', () => {
    expectNoViolation('console.error("error")', 50)
  })
})

// ─── Rule 51: No hardcoded URLs ─────────────────────────────────────────────

describe('Rule 51: No hardcoded URLs', () => {
  it('catches http://localhost', () => {
    expectViolation('const url = "http://localhost:3000"', 51)
  })

  it('catches 127.0.0.1', () => {
    expectViolation('const url = "http://127.0.0.1:8080"', 51)
  })
})

// ─── Path Checks ────────────────────────────────────────────────────────────

describe('Path checks', () => {
  describe('Rule 21: Store structure', () => {
    it('allows atoms.ts', () => {
      const result = checkFilePath('src/features/auth/store/atoms.ts')
      expect(result.find(v => v.rule === 21)).toBeUndefined()
    })

    it('blocks random-file.ts in store', () => {
      const result = checkFilePath('src/features/auth/store/random-file.ts')
      expect(result.find(v => v.rule === 21)).toBeDefined()
    })
  })

  describe('Rule 26: Infrastructure read-only', () => {
    it('blocks writes to ws/', () => {
      const result = checkFilePath('src/ws/connection.ts')
      expect(result.find(v => v.rule === 26)).toBeDefined()
    })
  })

  describe('Rule 28: kebab-case folders', () => {
    it('blocks PascalCase folders', () => {
      const result = checkFilePath('src/features/MyFeature/store/atoms.ts')
      expect(result.find(v => v.rule === 28)).toBeDefined()
    })

    it('blocks camelCase folders', () => {
      const result = checkFilePath('src/features/myFeature/store/atoms.ts')
      expect(result.find(v => v.rule === 28)).toBeDefined()
    })

    it('allows kebab-case', () => {
      const result = checkFilePath('src/features/my-feature/store/atoms.ts')
      expect(result.find(v => v.rule === 28)).toBeUndefined()
    })
  })

  describe('Rule 37: No new components/ui files', () => {
    it('blocks new file in components/ui/', () => {
      const result = checkFilePath('src/components/ui/my-new-component.tsx')
      expect(result.find(v => v.rule === 37)).toBeDefined()
    })
  })
})

// ─── Store Naming ───────────────────────────────────────────────────────────

describe('Store naming (Rule 22)', () => {
  it('catches atom not ending with Atom', () => {
    const violations = checkStoreNaming(
      'export const projects = atom([])',
      'src/features/thread/store/atoms.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeDefined()
  })

  it('allows proper atom naming', () => {
    const violations = checkStoreNaming(
      'export const projectsAtom = atom([])',
      'src/features/thread/store/atoms.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeUndefined()
  })

  it('catches action not following doXxxAtom', () => {
    const violations = checkStoreNaming(
      'export const switchThread = atom(null, (get, set) => {})',
      'src/features/thread/store/actions.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeDefined()
  })

  it('allows proper action naming', () => {
    const violations = checkStoreNaming(
      'export const doSwitchThreadAtom = atom(null, (get, set) => {})',
      'src/features/thread/store/actions.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeUndefined()
  })

  it('catches listener not following useXxxListeners', () => {
    const violations = checkStoreNaming(
      'export function threadListeners() {}',
      'src/features/thread/store/listeners.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeDefined()
  })

  it('catches handler not following createXxxHandlers', () => {
    const violations = checkStoreNaming(
      'export function threadHandlers() {}',
      'src/features/thread/store/handlers.ts',
    )
    expect(violations.find(v => v.rule === 22)).toBeDefined()
  })
})

// ─── Warning rules ──────────────────────────────────────────────────────────

describe('Warning rules', () => {
  it('Rule 77: warns on inline JSX handlers', () => {
    expectWarning('onClick={() => doSomething()}', 77)
  })

  it('Rule 79: warns on inline object props', () => {
    expectWarning('data={{ foo: 1 }}', 79)
  })

  it('Rule 79: does not warn on className', () => {
    expectNoWarning('className={{ foo: true }}', 79)
  })
})

// ─── Non-JSX files ──────────────────────────────────────────────────────────

describe('Non-JSX files', () => {
  it('skips JSX-specific rules for .ts files', () => {
    // inline styles in .ts file should not trigger
    expectNoViolation('style={{ color: "red" }}', 32, 'utils.ts')
  })

  it('still checks TS rules in .ts files', () => {
    expectViolation('const x: any = 5', 1, 'utils.ts')
  })
})

// ─── Full integration ───────────────────────────────────────────────────────

describe('runAllChecks integration', () => {
  it('combines content and path violations', () => {
    const result = runAllChecks(
      'const x: any = 5',
      'src/features/MyFeature/store/random.ts',
    )
    // Should have: rule 1 (any), rule 28 (PascalCase), rule 21 (bad store file)
    expect(result.violations.length).toBeGreaterThanOrEqual(3)
  })
})
