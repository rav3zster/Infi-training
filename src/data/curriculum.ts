/**
 * curriculum.ts
 * ─────────────────────
 * Seed data and re-exports from the Adaptive Study Load Engine.
 * All calculation logic now lives in engine/adaptiveEngine.ts
 */

import type { TrainingData, Module, Topic, SubTopic, Assessment, DifficultyLevel } from '../types'

export {
  TOTAL_COURSE_HOURS,
  JOINING_DATE,
  calculateMetrics,
  calculateStreak,
  getAllSubtopics,
  getAllAssessments,
  getNextStudyTopic,
  formatDate,
  calculateRemainingEstimatedWork,
} from '../engine/adaptiveEngine'

// ──────────────────────────────────────────────
// Helper factories (kept here for seed data)
// ──────────────────────────────────────────────

function sub(id: string, name: string): SubTopic {
  return { id, name, completed: false, hoursSpent: 0, lastStudied: '' }
}

function topic(
  id: string,
  name: string,
  subtopics: string[],
  meta?: {
    difficulty?: DifficultyLevel
    estimatedHours?: number
    learningObjectives?: string[]
    prerequisites?: string[]
    exercises?: string[]
  },
): Topic {
  return {
    id,
    name,
    subtopics: subtopics.map((s, i) => sub(`${id}-s${i + 1}`, s.trim())),
    meta: meta
      ? {
          difficulty: meta.difficulty ?? 'beginner',
          estimatedHours: meta.estimatedHours ?? 1,
          learningObjectives: meta.learningObjectives ?? [],
          prerequisites: meta.prerequisites ?? [],
          exercises: meta.exercises ?? [],
        }
      : undefined,
  }
}

function assessment(
  id: string,
  name: string,
  type: Assessment['type'],
  estimatedHours: number,
  description: string,
  prerequisites: string[] = [],
): Assessment {
  return { id, name, type, estimatedHours, description, prerequisites, completed: false, lastAttempted: '' }
}

function phaseModule(
  id: string,
  name: string,
  weight: number,
  phase: string,
  phaseOrder: number,
  topics: Topic[],
  assessments: Assessment[] = [],
): Module {
  return { id, name, weight, phase, phaseOrder, topics, assessments }
}

// ──────────────────────────────────────────────
// FA1 — Complete Java Learning Path
// Designed as a Senior Java Trainer at Infosys
// ──────────────────────────────────────────────

// ─── Phase 1: Java Fundamentals (Beginner) ───

const m2Phase1Topics: Topic[] = [
  topic(
    'm2-t1',
    'Java Environment & First Program',
    ['JVM, JDK, JRE architecture explained', 'Writing, compiling & running your first Java program', 'Package & import statements', 'Understanding public static void main(String[])'],
    {
      difficulty: 'beginner',
      estimatedHours: 2,
      learningObjectives: [
        'Explain the JVM, JDK, and JRE roles in Java development',
        'Compile and execute a simple Java program from the command line',
        'Organise code using packages and import statements',
        'Describe the significance of each part of the main method signature',
      ],
      prerequisites: [],
      exercises: [
        'Set up JDK and verify with `java -version` and `javac -version`',
        'Write a HelloWorld program with a custom package name',
        'Create a second class in the same package and call its method from main',
        'Experiment: What happens if you remove `static` from main? Document the error.',
      ],
    },
  ),
  topic(
    'm2-t2',
    'Java Primitives, Variables & Type System',
    ['Primitive types: byte, short, int, long, float, double, char, boolean', 'Variable declaration, naming conventions & scope', 'Type casting: implicit (widening) & explicit (narrowing)', 'Constants with the final keyword'],
    {
      difficulty: 'beginner',
      estimatedHours: 2.5,
      learningObjectives: [
        'Differentiate between the 8 primitive types and their memory sizes',
        'Declare, initialise, and reassign variables with proper naming conventions',
        'Perform implicit and explicit type casts correctly',
        'Use the final keyword to declare compile-time constants',
      ],
      prerequisites: ['m2-t1'],
      exercises: [
        'Create variables of each primitive type and print their min/max values using wrapper constants',
        'Write a temperature converter (Celsius ↔ Fahrenheit) using explicit casting',
        'Identify and fix type-mismatch compilation errors in provided code snippets',
        'Declare a final double PI = 3.14159 and attempt to reassign — observe the error',
      ],
    },
  ),
  topic(
    'm2-t3',
    'Operators & Expressions',
    ['Arithmetic, relational & logical operators', 'Bitwise operators & shift operations', 'Operator precedence & associativity', 'Short-circuit evaluation & ternary (? :) operator'],
    {
      difficulty: 'beginner',
      estimatedHours: 2,
      learningObjectives: [
        'Evaluate expressions using Java operator precedence rules',
        'Use relational and logical operators to build boolean conditions',
        'Apply bitwise operators for low-level bit manipulation',
        'Write concise conditional logic with the ternary operator',
      ],
      prerequisites: ['m2-t2'],
      exercises: [
        'Evaluate complex expressions step-by-step; verify with code',
        'Write a method that checks if a year is a leap year using logical operators',
        'Use bitwise XOR to swap two integers without a temporary variable',
        'Rewrite a chain of if-else statements using nested ternary operators (then discuss readability)',
      ],
    },
  ),
  topic(
    'm2-t4',
    'Control Flow: Selection & Iteration',
    ['if-else, else-if, switch-case (with arrow syntax)', 'for loop, enhanced for-each, while, do-while', 'break, continue & labelled statements', 'Common loop patterns & pitfalls (off-by-one, infinite loops)'],
    {
      difficulty: 'beginner',
      estimatedHours: 3,
      learningObjectives: [
        'Write correct if-else and switch-case selection statements',
        'Choose the appropriate loop construct for a given scenario',
        'Control loop execution with break and continue, including labelled variants',
        'Debug common iteration errors',
      ],
      prerequisites: ['m2-t3'],
      exercises: [
        'Implement a number-guessing game using while loops and if-else',
        'Print a multiplication table (1–10) using nested for loops',
        'Use a labelled break to exit from an outer loop',
        'Write a switch expression that returns a String (Java 14+ arrow syntax)',
      ],
    },
  ),
  topic(
    'm2-t5',
    'Arrays in Java',
    ['Single-dimensional arrays: declaration, initialisation, traversal', 'Multi-dimensional arrays (rectangular & jagged)', 'java.util.Arrays utility class (sort, binarySearch, fill, copyOf)', 'Variable-length arguments (varargs)'],
    {
      difficulty: 'beginner',
      estimatedHours: 2.5,
      learningObjectives: [
        'Create, initialise, and iterate over single and multi-dimensional arrays',
        'Use the Arrays utility class for common operations',
        'Distinguish between rectangular and jagged 2D arrays',
        'Write methods that accept variable-length argument lists',
      ],
      prerequisites: ['m2-t2', 'm2-t4'],
      exercises: [
        'Reverse an array in-place without using a second array',
        'Implement a method to find the second-largest element in an int array',
        'Create a jagged 2D array representing Pascal\'s Triangle (first 5 rows)',
        'Write a varargs method that computes the average of any number of doubles',
      ],
    },
  ),
  topic(
    'm2-t6',
    'Methods: Declaration, Overloading & Recursion',
    ['Method signature: access modifier, return type, name, parameters', 'Pass-by-value semantics in Java', 'Method overloading rules & use cases', 'Recursion: base case, recursive case, stack tracing', 'Recursion vs iteration trade-offs'],
    {
      difficulty: 'beginner-intermediate',
      estimatedHours: 3,
      learningObjectives: [
        'Declare methods with correct syntax and appropriate access levels',
        'Explain why Java is strictly pass-by-value',
        'Overload methods differentiating by parameter count, type, and order',
        'Write recursive methods and trace their call stack',
      ],
      prerequisites: ['m2-t4'],
      exercises: [
        'Write overloaded `area` methods for circle, rectangle, and triangle',
        'Implement a recursive factorial method — trace the stack for n=5',
        'Write a recursive binary search and compare with an iterative version',
        'Swap two integers using a method — explain why the swap doesn\'t persist outside',
      ],
    },
  ),
]

// ─── Phase 2: Object-Oriented Programming ───

const m2Phase2Topics: Topic[] = [
  topic(
    'm2-t7',
    'Classes, Objects & Constructors',
    ['Class declaration, fields, instance methods', 'Object instantiation with the new keyword', 'Constructors: default, parameterised, copy', 'this keyword — field shadowing, constructor chaining', 'Static members: variables, methods, blocks'],
    {
      difficulty: 'beginner-intermediate',
      estimatedHours: 3.5,
      learningObjectives: [
        'Design a Java class with fields, constructors, and instance methods',
        'Distinguish between instance members and static members',
        'Use constructor overloading and this() for constructor chaining',
        'Create objects and interact with their state through methods',
      ],
      prerequisites: ['m2-t1', 'm2-t2', 'm2-t6'],
      exercises: [
        'Model a BankAccount class with accountNumber, balance, and static interestRate',
        'Add a copy constructor that creates a new account with the same balance',
        'Use a static initializer block to load configuration values',
        'Write a main method that creates 3 BankAccount objects and performs deposits/withdrawals',
      ],
    },
  ),
  topic(
    'm2-t8',
    'String, StringBuilder & Wrapper Classes',
    ['String immutability & the String pool', 'Essential String methods (charAt, substring, indexOf, replace, split, join)', 'StringBuilder & StringBuffer for mutable strings', 'Wrapper classes & autoboxing/unboxing', 'Parsing: Integer.parseInt, Double.parseDouble, etc.'],
    {
      difficulty: 'beginner-intermediate',
      estimatedHours: 3,
      learningObjectives: [
        'Explain why String objects are immutable and how the String pool works',
        'Write efficient string manipulation code using StringBuilder',
        'Convert between primitives and wrapper objects with autoboxing',
        'Parse string input into numeric types safely',
      ],
      prerequisites: ['m2-t5', 'm2-t7'],
      exercises: [
        'Write a method that reverses each word in a sentence using StringBuilder',
        'Implement an anagram checker using toCharArray, sort, and equals',
        'Compare performance: String concatenation in a loop vs StringBuilder (document timing)',
        'Parse a comma-separated string of numbers into an int[] using split and Integer.parseInt',
      ],
    },
  ),
  topic(
    'm2-t9',
    'Inheritance & the Object Superclass',
    ['extends keyword, super() constructor call', 'Method overriding: @Override annotation & rules', 'Covariant return types', 'final classes & methods — design for inheritance or prohibit it', 'Object class: toString, equals, hashCode, and their contracts'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3.5,
      learningObjectives: [
        'Build inheritance hierarchies using extends with proper super() calls',
        'Override methods correctly and apply the @Override annotation',
        'Apply the final keyword to prevent inheritance or overriding',
        'Override toString, equals, and hashCode following their contracts',
      ],
      prerequisites: ['m2-t7'],
      exercises: [
        'Model an Employee → Manager, Developer, Intern hierarchy with a common calculatePay() method',
        'Override equals and hashCode for a Student class — verify with HashSet behaviour',
        'Create a final utility class (like java.lang.Math) with only static methods',
        'Discuss: Why must equals and hashCode be overridden together?',
      ],
    },
  ),
  topic(
    'm2-t10',
    'Polymorphism: Runtime & Compile-Time',
    ['Compile-time polymorphism (method overloading — revisit)', 'Runtime polymorphism (method overriding & dynamic dispatch)', 'Upcasting & downcasting with instanceof', 'The Liskov Substitution Principle (SOLID)'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3,
      learningObjectives: [
        'Distinguish between compile-time and runtime polymorphism',
        'Use dynamic dispatch to write polymorphic code',
        'Safely downcast references using instanceof pattern matching',
        'Design classes that obey the Liskov Substitution Principle',
      ],
      prerequisites: ['m2-t9'],
      exercises: [
        'Create a Shape hierarchy with an abstract draw() method — demonstrate polymorphic behaviour in an array',
        'Write a method that accepts a List<Shape> and calls draw() on each element',
        'Use pattern matching for instanceof (Java 16+) to downcast safely',
        'Identify LSP violations in a provided code sample and refactor them',
      ],
    },
  ),
  topic(
    'm2-t11',
    'Encapsulation & Access Control',
    ['private, default (package-private), protected, public', 'Getter & setter conventions (JavaBeans pattern)', 'Data hiding — why expose behaviour, not data', 'Package-level access & module encapsulation (Java 9+)'],
    {
      difficulty: 'intermediate',
      estimatedHours: 2,
      learningObjectives: [
        'Choose the appropriate access modifier for each class member',
        'Implement getters and setters to protect class invariants',
        'Design classes that expose behaviour while hiding internal state',
        'Explain how packages control visibility at the namespace level',
      ],
      prerequisites: ['m2-t7', 'm2-t9'],
      exercises: [
        'Refactor a poorly-designed class with public fields into a properly encapsulated one',
        'Implement an immutable Person class using private final fields and no setters',
        'Create classes in two different packages and observe which members are accessible',
        'Write a defensive copy getter that returns a copy of an internal array/list',
      ],
    },
  ),
  topic(
    'm2-t12',
    'Abstract Classes & Interfaces',
    ['Abstract class: abstract methods, constructors, fields', 'Interface: declaration, implementation, constants', 'Default & static methods in interfaces (Java 8+)', 'Functional interfaces (SAM — Single Abstract Method)', 'Abstract class vs interface — when to choose which'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3.5,
      learningObjectives: [
        'Design abstract classes that define common behaviour with partial implementation',
        'Implement interfaces with default and static methods',
        'Identify and create functional interfaces for lambda expressions',
        'Decide between abstract class and interface for a given design scenario',
      ],
      prerequisites: ['m2-t9', 'm2-t10'],
      exercises: [
        'Design a PaymentProcessor abstract class with an abstract processPayment() and concrete logging method',
        'Create a Playable interface with default methods — implement it for MusicPlayer and VideoPlayer',
        'Define a functional interface Operation<T> with a method T apply(T a, T b)',
        'Compare and contrast: when would you choose an abstract class over an interface?',
      ],
    },
  ),
  topic(
    'm2-t13',
    'Enums & Records (Java 16+)',
    ['Enum declaration: constants, fields, methods, constructors', 'EnumSet & EnumMap — specialised collections', 'switch with enums (exhaustiveness)', 'Java Records: compact constructors, accessors, equals/hashCode', 'When to use records vs traditional classes'],
    {
      difficulty: 'intermediate',
      estimatedHours: 2,
      learningObjectives: [
        'Define enums with fields, methods, and constructors',
        'Use enums in switch expressions with exhaustiveness checking',
        'Declare records for transparent, immutable data carriers',
        'Choose between a record and a full class based on the use case',
      ],
      prerequisites: ['m2-t7', 'm2-t11'],
      exercises: [
        'Model an enum DayOfWeek with a method isWeekend() that returns boolean',
        'Write a switch expression over a TrafficLight enum (RED, YELLOW, GREEN)',
        'Declare a Point record with x and y — verify equals, hashCode, toString are auto-generated',
        'Compare a record with a hand-written DTO class — what boilerplate is saved?',
      ],
    },
  ),
]

// ─── Phase 3: Core API & Advanced Java ───

const m2Phase3Topics: Topic[] = [
  topic(
    'm2-t14',
    'Generics & Type Safety',
    ['Generic classes, interfaces & methods', 'Type parameters naming conventions (T, E, K, V)', 'Bounded type parameters (<T extends Number>)', 'Wildcards: ?, ? extends T, ? super T', 'Type erasure & bridge methods — what happens at runtime'],
    {
      difficulty: 'intermediate-advanced',
      estimatedHours: 3,
      learningObjectives: [
        'Write generic classes and methods with appropriate type parameters',
        'Apply bounded type parameters to constrain generic types',
        'Use wildcard types for flexible API design (producer-extends, consumer-super)',
        'Explain how type erasure enables generics while maintaining backward compatibility',
      ],
      prerequisites: ['m2-t7', 'm2-t5'],
      exercises: [
        'Implement a generic Box<T> class with get/set methods',
        'Write a generic method countGreaterThan(T[] array, T elem) using bounded parameters',
        'Create a wildcard-based copy method: void copy(List<? super T> dest, List<? extends T> src)',
        'Use reflection to inspect a generic class at runtime — observe erasure',
      ],
    },
  ),
  topic(
    'm2-t15',
    'Collections Framework — List & Set',
    ['List: ArrayList vs LinkedList — when to use each', 'Set: HashSet, LinkedHashSet, TreeSet (ordering & performance)', 'hashCode() & equals() contract in hash-based collections', 'Iteration: Iterator, ListIterator, enhanced for-each, forEach'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3.5,
      learningObjectives: [
        'Choose the correct List and Set implementation based on performance requirements',
        'Explain how hashCode and equals affect HashSet behaviour',
        'Implement Comparable and Comparator for custom sorting',
        'Traverse collections using different iteration strategies',
      ],
      prerequisites: ['m2-t5', 'm2-t9', 'm2-t14'],
      exercises: [
        'Compare ArrayList vs LinkedList insertion/deletion performance with a benchmark loop',
        'Create a Set<Student> that deduplicates based on studentId using hashCode/equals',
        'Sort a list of Employee objects by salary using Comparator.comparingDouble',
        'Remove duplicate words from a sentence using a LinkedHashSet (preserve order)',
      ],
    },
  ),
  topic(
    'm2-t16',
    'Collections Framework — Map & Queue',
    ['Map: HashMap, LinkedHashMap, TreeMap — ordering & null handling', 'Map iteration: entrySet, keySet, values', 'computeIfAbsent, merge, putIfAbsent (Java 8+)', 'Queue: PriorityQueue, Deque with ArrayDeque'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3,
      learningObjectives: [
        'Choose the correct Map implementation for ordering and performance needs',
        'Use modern Map methods (computeIfAbsent, merge) for cleaner code',
        'Implement a frequency counter using a HashMap',
        'Use Deque as both stack (LIFO) and queue (FIFO)',
      ],
      prerequisites: ['m2-t15'],
      exercises: [
        'Build a word frequency counter from a text file using HashMap with merge',
        'Implement an LRU cache using LinkedHashMap (override removeEldestEntry)',
        'Use a Deque to check if a string is a palindrome',
        'Schedule tasks in order of priority using PriorityQueue with a custom Comparator',
      ],
    },
  ),
  topic(
    'm2-t17',
    'Exception Handling & Best Practices',
    ['Checked vs unchecked exceptions: when to use each', 'try-catch-finally — resource cleanup in finally', 'try-with-resources (AutoCloseable) — Java 7+', 'throw, throws & custom exception classes', 'Exception handling anti-patterns & best practices'],
    {
      difficulty: 'intermediate',
      estimatedHours: 3,
      learningObjectives: [
        'Differentiate between checked and unchecked exceptions and use them appropriately',
        'Write robust code with try-catch-finally and try-with-resources',
        'Define custom exception classes that extend Exception or RuntimeException',
        'Apply exception handling best practices and avoid common anti-patterns',
      ],
      prerequisites: ['m2-t6', 'm2-t7'],
      exercises: [
        'Read a file using try-with-resources — handle FileNotFoundException and IOException separately',
        'Create a custom InsufficientFundsException for the BankAccount class',
        'Write a method that throws multiple checked exceptions — demonstrate caller handling',
        'Review provided code for exception-handling anti-patterns: swallowing exceptions, catching Throwable, etc.',
      ],
    },
  ),
  topic(
    'm2-t18',
    'Lambda Expressions & Functional Interfaces',
    ['Lambda syntax: (parameters) -> expression/block', 'java.util.function: Consumer, Supplier, Predicate, Function', 'Method references: Class::staticMethod, object::instanceMethod', 'Composing lambdas: andThen, compose, negate, or'],
    {
      difficulty: 'intermediate-advanced',
      estimatedHours: 3,
      learningObjectives: [
        'Write lambda expressions for common functional interfaces',
        'Replace anonymous inner classes with equivalent lambdas',
        'Use method references for concise lambda expressions',
        'Chain and compose functional operations',
      ],
      prerequisites: ['m2-t12', 'm2-t14'],
      exercises: [
        'Replace all anonymous Comparator implementations in existing code with lambdas',
        'Build a processing pipeline: filter → map → collect using Predicate and Function',
        'Use method references: Class::method for static, System.out::println for instance',
        'Chain Predicates with and(), or(), negate() to build complex filtering logic',
      ],
    },
  ),
  topic(
    'm2-t19',
    'Stream API & Optional',
    ['Creating streams: from collections, arrays, Stream.of, Stream.iterate', 'Intermediate ops: filter, map, flatMap, distinct, sorted, peek', 'Terminal ops: forEach, collect, reduce, count, anyMatch/allMatch/noneMatch', 'Collectors: toList, toSet, toMap, groupingBy, partitioningBy', 'Optional: creation, map, flatMap, orElse, orElseGet, orElseThrow'],
    {
      difficulty: 'intermediate-advanced',
      estimatedHours: 4,
      learningObjectives: [
        'Create and chain stream operations fluently',
        'Use Collectors to aggregate stream results into collections',
        'Apply reduce for custom aggregations',
        'Use Optional to write null-safe code without NullPointerException',
      ],
      prerequisites: ['m2-t15', 'm2-t18'],
      exercises: [
        'Process a list of transactions: filter by amount > 1000, group by currency, sum amounts',
        'Use flatMap to flatten a list of orders into a single stream of products',
        'Implement a custom collector that joins strings with a delimiter and prefix/suffix',
        'Refactor a method full of null checks to use Optional fluently',
      ],
    },
  ),
  topic(
    'm2-t20',
    'I/O, File Handling & NIO',
    ['Byte streams: FileInputStream, FileOutputStream, BufferedInputStream', 'Character streams: FileReader, FileWriter, BufferedReader, PrintWriter', 'Scanner for parsing structured input', 'NIO.2: Path, Files, walk, find, readString/writeString (Java 11+)', 'Object serialization (Serializable, transient)'],
    {
      difficulty: 'intermediate-advanced',
      estimatedHours: 3.5,
      learningObjectives: [
        'Read and write text files using character streams and NIO convenience methods',
        'Use Scanner to parse tokens from files or user input',
        'Traverse directory trees using Files.walk and Files.find',
        'Serialize and deserialize Java objects with ObjectOutputStream/ObjectInputStream',
      ],
      prerequisites: ['m2-t17'],
      exercises: [
        'Write a program that reads a CSV file and prints statistics per column',
        'Copy a large file using BufferedInputStream/BufferedOutputStream — measure performance',
        'Use Files.walk to find all .txt files in a directory tree and count total lines',
        'Implement a Serializable Employee class with a transient password field',
      ],
    },
  ),
  topic(
    'm2-t21',
    'Multithreading & Concurrency Basics',
    ['Thread class & Runnable interface', 'Thread lifecycle: NEW, RUNNABLE, BLOCKED, WAITING, TIMED_WAITING, TERMINATED', 'synchronized keyword & intrinsic locks', 'wait, notify, notifyAll — inter-thread communication', 'ExecutorService, ThreadPoolExecutor & Future<T>'],
    {
      difficulty: 'advanced',
      estimatedHours: 4,
      learningObjectives: [
        'Create and start threads using Thread and Runnable',
        'Use synchronized blocks and methods to protect shared state',
        'Coordinate threads with wait/notify',
        'Submit tasks to an ExecutorService and retrieve results via Future',
      ],
      prerequisites: ['m2-t7', 'm2-t17'],
      exercises: [
        'Write a counter that increments across 5 threads — demonstrate race condition, then fix with synchronized',
        'Implement producer-consumer using wait/notify on a shared Queue',
        'Submit 10 Callable tasks to an ExecutorService and process the results',
        'Measure throughput: single-threaded vs thread-pool for I/O-bound tasks',
      ],
    },
  ),
]

// ─── Phase 4: Data Structures & Algorithms (Java Focus) ───

const m2Phase4Topics: Topic[] = [
  topic(
    'm2-t22',
    'Stack & Queue — Implementations & Use Cases',
    ['Stack: ArrayDeque vs legacy Stack class', 'Queue: LinkedList, PriorityQueue, ArrayDeque', 'Real-world: expression evaluation, undo/redo, BFS traversal', 'Deque as both stack and queue'],
    {
      difficulty: 'intermediate',
      estimatedHours: 2.5,
      learningObjectives: [
        'Implement LIFO (stack) and FIFO (queue) behaviour using ArrayDeque',
        'Use PriorityQueue for priority-based ordering',
        'Apply stacks to solve bracket-matching and expression evaluation problems',
        'Apply queues to model breadth-first search and scheduling problems',
      ],
      prerequisites: ['m2-t5', 'm2-t15'],
      exercises: [
        'Implement a browser forward/back navigation system using two Deque stacks',
        'Check if parentheses in a string are balanced using a Stack',
        'Use a Queue to implement a simple task scheduler (FIFO)',
        'Evaluate a postfix expression using a Stack of integers',
      ],
    },
  ),
  topic(
    'm2-t23',
    'Searching Algorithms — Linear & Binary',
    ['Linear search — O(n) iterative implementation', 'Binary search — iterative & recursive implementations', 'Arrays.binarySearch and Collections.binarySearch', 'Search complexity analysis & when to use each'],
    {
      difficulty: 'intermediate',
      estimatedHours: 2,
      learningObjectives: [
        'Implement linear search and analyse its O(n) time complexity',
        'Implement recursive and iterative binary search on sorted arrays',
        'Use built-in binarySearch methods from the Java standard library',
        'Select the appropriate search algorithm for a given dataset',
      ],
      prerequisites: ['m2-t5', 'm2-t6'],
      exercises: [
        'Implement linear search — measure time on arrays of sizes 10, 100, 1000, 10000',
        'Implement recursive binary search and trace the call stack for target=42',
        'Search a sorted array of 1 million integers — compare linear vs binary search time',
        'Use Collections.binarySearch on a sorted List<String> of names',
      ],
    },
  ),
  topic(
    'm2-t24',
    'Sorting Algorithms — Bubble, Selection, Insertion',
    ['Bubble sort — compare adjacent, swap', 'Selection sort — find min, place at front', 'Insertion sort — build sorted portion left-to-right', 'Arrays.sort (Dual-Pivot Quicksort) & Collections.sort (TimSort)'],
    {
      difficulty: 'intermediate',
      estimatedHours: 2.5,
      learningObjectives: [
        'Implement bubble, selection, and insertion sort from scratch',
        'Compare the time complexity of all three (O(n²)) and identify their best-case behaviours',
        'Explain why built-in sorts outperform O(n²) sorts on large datasets',
        'Use Arrays.sort and Collections.sort in real code',
      ],
      prerequisites: ['m2-t5', 'm2-t6'],
      exercises: [
        'Implement all three sorts and count the number of swaps each performs on the same array',
        'Measure time: sort a 10,000-element array with insertion sort vs Arrays.sort',
        'Implement an optimized bubble sort that stops early if no swaps are made',
        'Sort an ArrayList of Employee objects by name using Collections.sort',
      ],
    },
  ),
]

// ─── Phase 5: Assessments & Capstone ───

const m2Phase5Assessments: Assessment[] = [
  assessment(
    'm2-checkpoint-1',
    'Revision Checkpoint: Java Fundamentals',
    'revision',
    1.5,
    'Covers Java Environment → Arrays → Methods. Practice coding problems on operators, control flow, arrays, and recursion. Identify weak areas before advancing to OOP.',
    ['m2-t1', 'm2-t2', 'm2-t3', 'm2-t4', 'm2-t5', 'm2-t6'],
  ),
  assessment(
    'm2-quiz-1',
    'OOP Foundations Quiz',
    'quiz',
    1,
    '20 multiple-choice questions covering classes, objects, constructors, static members, String handling, and wrapper classes.',
    ['m2-t7', 'm2-t8'],
  ),
  assessment(
    'm2-miniproject-1',
    'Mini Project: Zoo Management System',
    'mini-project',
    4,
    'Build a Zoo Management System applying inheritance, polymorphism, and encapsulation. Includes Animal hierarchy, employee management, feeding schedules, and enclosure tracking.',
    ['m2-t9', 'm2-t10', 'm2-t11'],
  ),
  assessment(
    'm2-checkpoint-2',
    'Revision Checkpoint: OOP Mastery',
    'revision',
    2,
    'Consolidate understanding of abstract classes, interfaces, enums, and records. Complete a set of targeted coding problems covering all OOP topics.',
    ['m2-t12', 'm2-t13', 'm2-t14'],
  ),
  assessment(
    'm2-quiz-2',
    'Collections & Generics Quiz',
    'quiz',
    1,
    '15 multiple-choice questions + 5 coding snippets on List, Set, Map, Queue, generics, and iteration patterns.',
    ['m2-t14', 'm2-t15', 'm2-t16'],
  ),
  assessment(
    'm2-miniproject-2',
    'Mini Project: Employee Payroll Processor',
    'mini-project',
    5,
    'Process employee payroll data from a CSV file using Streams, Collections, and custom exceptions. Generate reports: department totals, top earners, tax calculations.',
    ['m2-t15', 'm2-t16', 'm2-t17', 'm2-t18', 'm2-t20'],
  ),
  assessment(
    'm2-mock',
    'Mock Assessment: Java Coding Round',
    'mock',
    2,
    'Simulated coding interview with 3 problems: (1) algorithmic, (2) OOP design, (3) Stream API data processing. Timed at 2 hours with partial scoring.',
    ['m2-t17', 'm2-t19', 'm2-t21', 'm2-t22', 'm2-t23', 'm2-t24'],
  ),
  assessment(
    'm2-capstone',
    'Capstone Project: Library Management System',
    'capstone',
    8,
    'Full-featured console-based Library Management System. Must implement: user management (CRUD), book catalogue with search, checkout/return flow with due dates, fine calculation, persistence to files, concurrency-safe operations, and reporting via Streams.',
    ['m2-t9', 'm2-t10', 'm2-t14', 'm2-t15', 'm2-t16', 'm2-t17', 'm2-t20', 'm2-t21'],
  ),
]

const FA1_MODULE: Module = phaseModule(
  'm2',
  'FA1 — Java Programming & OOPs',
  45,
  'Full Java Learning Path',
  2,
  [
    ...m2Phase1Topics,
    ...m2Phase2Topics,
    ...m2Phase3Topics,
    ...m2Phase4Topics,
  ],
  m2Phase5Assessments,
)

// ──────────────────────────────────────────────
// Module 1 & 3 — kept with metadata
// ──────────────────────────────────────────────

const MODULE_1: Module = {
  id: 'm1',
  name: 'Web Foundations & Generic Basics',
  weight: 15,
  phase: 'Generic Training',
  phaseOrder: 1,
  topics: [
    topic('m1-t1', 'HTML5 & Document Structure', ['Semantic elements', 'Forms & input types', 'Form validation (HTML5 + JS)'], {
      difficulty: 'beginner', estimatedHours: 2.5,
      learningObjectives: ['Use semantic HTML elements for accessible documents', 'Build and validate HTML forms', 'Apply HTML5 validation attributes and custom JavaScript validation'],
      prerequisites: [], exercises: ['Create a semantic blog layout', 'Build a registration form with client-side validation'],
    }),
    topic('m1-t2', 'CSS3 Layout Engines', ['Selectors & specificity', 'Box model & positioning', 'Flexbox layouts', 'CSS Grid layouts'], {
      difficulty: 'beginner', estimatedHours: 3,
      learningObjectives: ['Calculate selector specificity', 'Position elements using the box model', 'Build responsive layouts with Flexbox and Grid'],
      prerequisites: ['m1-t1'], exercises: ['Recreate a responsive card layout with Flexbox', 'Build a full-page dashboard using CSS Grid'],
    }),
    topic('m1-t3', 'JavaScript Core', ['DOM manipulation (querySelector, events)', 'ES6+ features (let/const, arrow, destructuring)', 'Event handling, propagation & delegation'], {
      difficulty: 'beginner-intermediate', estimatedHours: 3.5,
      learningObjectives: ['Select and modify DOM elements', 'Use ES6+ syntax including arrow functions and destructuring', 'Handle events with proper propagation control'],
      prerequisites: ['m1-t2'], exercises: ['Build a dynamic to-do list with add/delete/complete', 'Implement a tabbed interface with event delegation'],
    }),
  ],
}

const MODULE_3: Module = {
  id: 'm3',
  name: 'FA2 — Relational Databases & SQL',
  weight: 40,
  phase: 'Databases & Querying',
  phaseOrder: 3,
  topics: [
    topic('m3-t1', 'RDBMS Data Modeling', ['Entity-Relationships, Keys', 'Integrity Constraints'], {
      difficulty: 'beginner', estimatedHours: 2.5,
      learningObjectives: ['Design ER diagrams for real-world scenarios', 'Define primary and foreign keys', 'Implement integrity constraints'],
      prerequisites: [], exercises: ['Design an ER diagram for an e-commerce system', 'Write CREATE TABLE with all constraint types'],
    }),
    topic('m3-t2', 'Normalization Engines', ['Redundancy reduction', '1NF, 2NF, 3NF rules'], {
      difficulty: 'intermediate', estimatedHours: 2.5,
      learningObjectives: ['Identify normal form violations', 'Normalize tables through 3NF'],
      prerequisites: ['m3-t1'], exercises: ['Normalize an unnormalized student enrollment table to 3NF'],
    }),
    topic('m3-t3', 'SQL Schema Operations (DDL)', ['CREATE, ALTER, DROP, TRUNCATE'], {
      difficulty: 'beginner', estimatedHours: 1.5,
      learningObjectives: ['Create and modify database schemas', 'Understand DDL vs DML'],
      prerequisites: ['m3-t1'], exercises: ['Create a database schema for a library system using DDL'],
    }),
    topic('m3-t4', 'SQL Mutation Operations (DML)', ['INSERT, UPDATE, DELETE'], {
      difficulty: 'beginner', estimatedHours: 1.5,
      learningObjectives: ['Insert, update, and delete data', 'Use WHERE clauses in mutations'],
      prerequisites: ['m3-t3'], exercises: ['Populate and modify data in the library schema'],
    }),
    topic('m3-t5', 'Transaction Management (TCL)', ['COMMIT, ROLLBACK, SAVEPOINT', 'ACID properties'], {
      difficulty: 'intermediate', estimatedHours: 2,
      learningObjectives: ['Manage transactions with TCL commands', 'Explain ACID properties and their importance'],
      prerequisites: ['m3-t4'], exercises: ['Write transaction scripts with SAVEPOINT and ROLLBACK'],
    }),
    topic('m3-t6', 'Relational Querying', ['SELECT syntax, WHERE, GROUP BY, HAVING, ORDER BY'], {
      difficulty: 'intermediate', estimatedHours: 3,
      learningObjectives: ['Write SELECT queries with filtering and grouping', 'Use aggregate functions with HAVING'],
      prerequisites: ['m3-t4'], exercises: ['Write reports using GROUP BY with HAVING filters'],
    }),
    topic('m3-t7', 'Advanced Query Datasets (Joins)', ['Inner, Outer, Left, Right, Self Joins'], {
      difficulty: 'intermediate', estimatedHours: 3,
      learningObjectives: ['Write all types of SQL JOINs', 'Choose the correct JOIN for a query requirement'],
      prerequisites: ['m3-t6'], exercises: ['Write 5 different JOIN queries on a multi-table employee database'],
    }),
    topic('m3-t8', 'Complex Relations (Sub-queries)', ['Nested & Correlated Sub-queries', 'Aggregate functions: SUM, AVG, COUNT, MAX, MIN'], {
      difficulty: 'intermediate-advanced', estimatedHours: 3,
      learningObjectives: ['Write nested and correlated sub-queries', 'Use aggregate functions in sub-queries'],
      prerequisites: ['m3-t7'], exercises: ['Find employees earning above department average using correlated sub-query'],
    }),
  ],
}

// ──────────────────────────────────────────────
// Seed data factory
// ──────────────────────────────────────────────

export function createSeedData(): TrainingData {
  return {
    modules: [MODULE_1, FA1_MODULE, MODULE_3],
    dailyLogs: [],
    studySessions: [],
  }
}
