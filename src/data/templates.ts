import type { Pipeline } from "../types/pipeline";

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  nodeCount: number;
  pipeline: Pipeline;
}

export const TEMPLATES: PipelineTemplate[] = [
  // 1. Code Review (3 nodes)
  {
    id: "code-review",
    name: "Code Review",
    description: "AI analyzes code, waits for approval, then writes a detailed review",
    icon: "search",
    tags: ["ai", "review"],
    nodeCount: 3,
    pipeline: {
      name: "Code Review",
      description: "Automated code review pipeline",
      version: "1.0.0",
      variables: { target_branch: "main" },
      nodes: [
        { id: "t1-n1", name: "Analyze Code", type: "ai-task", instructions: "Analyze the recent changes in the codebase. Look for bugs, code smells, and potential improvements. Summarize your findings.", inputs: [], outputs: ["analysis"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t1-n2", name: "Review Gate", type: "approval-gate", instructions: "Review the AI analysis before proceeding", inputs: [], outputs: [], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t1-n3", name: "Write Review", type: "ai-task", instructions: "Based on the analysis, write a detailed code review with specific suggestions for improvement. Format as markdown.", inputs: ["analysis"], outputs: ["review"], requires_tools: [], position: { x: 600, y: 0 } },
      ],
      edges: [
        { id: "t1-e1", from: "t1-n1", to: "t1-n2", condition: "success" },
        { id: "t1-e2", from: "t1-n2", to: "t1-n3", condition: "success" },
      ],
    },
  },
  // 2. Bug Fix (4 nodes)
  {
    id: "bug-fix",
    name: "Bug Fix",
    description: "AI diagnoses a bug, implements a fix, runs tests, and commits",
    icon: "bug",
    tags: ["ai", "testing", "git"],
    nodeCount: 4,
    pipeline: {
      name: "Bug Fix",
      description: "Automated bug diagnosis and fix pipeline",
      version: "1.0.0",
      variables: { bug_description: "" },
      nodes: [
        { id: "t2-n1", name: "Diagnose Bug", type: "ai-task", instructions: "Investigate the bug described in $bug_description. Find the root cause and propose a fix.", inputs: [], outputs: ["diagnosis"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t2-n2", name: "Implement Fix", type: "ai-task", instructions: "Implement the fix based on the diagnosis. Make minimal, focused changes.", inputs: ["diagnosis"], outputs: ["changes"], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t2-n3", name: "Run Tests", type: "shell", instructions: "npm test", inputs: [], outputs: [], requires_tools: [], position: { x: 600, y: 0 } },
        { id: "t2-n4", name: "Commit Fix", type: "git", instructions: "git add -A && git commit -m \"fix: $bug_description\"", inputs: [], outputs: [], requires_tools: [], position: { x: 900, y: 0 } },
      ],
      edges: [
        { id: "t2-e1", from: "t2-n1", to: "t2-n2", condition: "success" },
        { id: "t2-e2", from: "t2-n2", to: "t2-n3", condition: "success" },
        { id: "t2-e3", from: "t2-n3", to: "t2-n4", condition: "success" },
      ],
    },
  },
  // 3. CI/CD (5 nodes)
  {
    id: "ci-cd",
    name: "CI/CD",
    description: "Lint, test, approve, build, and deploy in sequence",
    icon: "rocket",
    tags: ["shell", "testing"],
    nodeCount: 5,
    pipeline: {
      name: "CI-CD",
      description: "Continuous integration and deployment pipeline",
      version: "1.0.0",
      variables: { build_command: "npm run build", deploy_command: "npm run deploy" },
      nodes: [
        { id: "t3-n1", name: "Lint", type: "shell", instructions: "npm run lint", inputs: [], outputs: [], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t3-n2", name: "Test", type: "shell", instructions: "npm test", inputs: [], outputs: [], requires_tools: [], position: { x: 250, y: 0 } },
        { id: "t3-n3", name: "Deploy Approval", type: "approval-gate", instructions: "Approve deployment to production", inputs: [], outputs: [], requires_tools: [], position: { x: 500, y: 0 } },
        { id: "t3-n4", name: "Build", type: "shell", instructions: "$build_command", inputs: [], outputs: [], requires_tools: [], position: { x: 750, y: 0 } },
        { id: "t3-n5", name: "Deploy", type: "shell", instructions: "$deploy_command", inputs: [], outputs: [], requires_tools: [], position: { x: 1000, y: 0 } },
      ],
      edges: [
        { id: "t3-e1", from: "t3-n1", to: "t3-n2", condition: "success" },
        { id: "t3-e2", from: "t3-n2", to: "t3-n3", condition: "success" },
        { id: "t3-e3", from: "t3-n3", to: "t3-n4", condition: "success" },
        { id: "t3-e4", from: "t3-n4", to: "t3-n5", condition: "success" },
      ],
    },
  },
  // 4. Ticket-to-PR (4 nodes)
  {
    id: "ticket-to-pr",
    name: "Ticket to PR",
    description: "Read a ticket, implement changes, run tests, and create a PR",
    icon: "ticket",
    tags: ["ai", "git", "testing"],
    nodeCount: 4,
    pipeline: {
      name: "Ticket to PR",
      description: "Automated ticket implementation pipeline",
      version: "1.0.0",
      variables: { ticket_url: "" },
      nodes: [
        { id: "t4-n1", name: "Read Ticket", type: "ai-task", instructions: "Read and understand the requirements from ticket: $ticket_url. Break down the implementation steps.", inputs: [], outputs: ["requirements"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t4-n2", name: "Implement", type: "ai-task", instructions: "Implement the changes based on the requirements. Follow existing code patterns and conventions.", inputs: ["requirements"], outputs: ["changes"], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t4-n3", name: "Run Tests", type: "shell", instructions: "npm test", inputs: [], outputs: [], requires_tools: [], position: { x: 600, y: 0 } },
        { id: "t4-n4", name: "Create PR", type: "git", instructions: "git add -A && git commit -m \"feat: implement ticket\" && gh pr create --fill", inputs: [], outputs: [], requires_tools: [], position: { x: 900, y: 0 } },
      ],
      edges: [
        { id: "t4-e1", from: "t4-n1", to: "t4-n2", condition: "success" },
        { id: "t4-e2", from: "t4-n2", to: "t4-n3", condition: "success" },
        { id: "t4-e3", from: "t4-n3", to: "t4-n4", condition: "success" },
      ],
    },
  },
  // 5. Release (4 nodes)
  {
    id: "release",
    name: "Release",
    description: "Run tests, generate changelog, approve, then tag a release",
    icon: "tag",
    tags: ["git", "ai"],
    nodeCount: 4,
    pipeline: {
      name: "Release",
      description: "Release management pipeline",
      version: "1.0.0",
      variables: { version: "" },
      nodes: [
        { id: "t5-n1", name: "Run Tests", type: "shell", instructions: "npm test", inputs: [], outputs: [], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t5-n2", name: "Generate Changelog", type: "ai-task", instructions: "Generate a changelog from recent git commits. Categorize changes into Features, Fixes, and Other. Format as markdown.", inputs: [], outputs: ["changelog"], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t5-n3", name: "Release Approval", type: "approval-gate", instructions: "Review changelog and approve release", inputs: [], outputs: [], requires_tools: [], position: { x: 600, y: 0 } },
        { id: "t5-n4", name: "Tag Release", type: "shell", instructions: "git tag -a v$version -m \"Release v$version\" && git push --tags", inputs: [], outputs: [], requires_tools: [], position: { x: 900, y: 0 } },
      ],
      edges: [
        { id: "t5-e1", from: "t5-n1", to: "t5-n2", condition: "success" },
        { id: "t5-e2", from: "t5-n2", to: "t5-n3", condition: "success" },
        { id: "t5-e3", from: "t5-n3", to: "t5-n4", condition: "success" },
      ],
    },
  },
  // 6. Add a Feature (4 nodes)
  {
    id: "add-feature",
    name: "Add a Feature",
    description: "Takes requirements, scaffolds code, writes tests, and commits",
    icon: "sparkles",
    tags: ["ai", "testing", "git"],
    nodeCount: 4,
    pipeline: {
      name: "Add a Feature",
      description: "Scaffold a new feature from requirements",
      version: "1.0.0",
      variables: { feature_description: "" },
      nodes: [
        { id: "t6-n1", name: "Plan Feature", type: "ai-task", instructions: "Read the feature requirements: $feature_description. Analyze the existing codebase and create a detailed implementation plan listing the files to create or modify.", inputs: [], outputs: ["plan"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t6-n2", name: "Implement", type: "ai-task", instructions: "Implement the feature based on the plan. Follow existing code patterns and conventions. Create any necessary files.", inputs: ["plan"], outputs: ["changes"], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t6-n3", name: "Write Tests", type: "ai-task", instructions: "Write tests for the newly implemented feature. Cover the main functionality and edge cases. Use the existing test framework and patterns.", inputs: ["changes"], outputs: ["tests"], requires_tools: [], position: { x: 600, y: 0 } },
        { id: "t6-n4", name: "Commit", type: "git", instructions: "git add -A && git commit -m \"feat: $feature_description\"", inputs: [], outputs: [], requires_tools: [], position: { x: 900, y: 0 } },
      ],
      edges: [
        { id: "t6-e1", from: "t6-n1", to: "t6-n2", condition: "success" },
        { id: "t6-e2", from: "t6-n2", to: "t6-n3", condition: "success" },
        { id: "t6-e3", from: "t6-n3", to: "t6-n4", condition: "success" },
      ],
    },
  },
  // 7. Generate API Docs (3 nodes)
  {
    id: "api-docs",
    name: "Generate API Docs",
    description: "Reads your code, generates comprehensive API documentation",
    icon: "book",
    tags: ["ai", "docs"],
    nodeCount: 3,
    pipeline: {
      name: "Generate API Docs",
      description: "Auto-generate API documentation from code",
      version: "1.0.0",
      variables: { source_path: "src" },
      nodes: [
        { id: "t7-n1", name: "Analyze API", type: "ai-task", instructions: "Read through the code in $source_path. Identify all public APIs, functions, types, and endpoints. List them with their parameters, return types, and a brief description of what each does.", inputs: [], outputs: ["api_inventory"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t7-n2", name: "Generate Docs", type: "ai-task", instructions: "Using the API inventory, generate comprehensive markdown documentation. Include: overview, installation/setup, API reference with examples, and common usage patterns.", inputs: ["api_inventory"], outputs: ["documentation"], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t7-n3", name: "Review Gate", type: "approval-gate", instructions: "Review the generated documentation before saving", inputs: [], outputs: [], requires_tools: [], position: { x: 600, y: 0 } },
      ],
      edges: [
        { id: "t7-e1", from: "t7-n1", to: "t7-n2", condition: "success" },
        { id: "t7-e2", from: "t7-n2", to: "t7-n3", condition: "success" },
      ],
    },
  },
  // 8. Refactor Module (3 nodes)
  {
    id: "refactor",
    name: "Refactor Module",
    description: "Analyzes a module, refactors with best practices, and runs tests",
    icon: "wrench",
    tags: ["ai", "testing"],
    nodeCount: 3,
    pipeline: {
      name: "Refactor Module",
      description: "Refactor code with best practices",
      version: "1.0.0",
      variables: { target_path: "" },
      nodes: [
        { id: "t8-n1", name: "Analyze & Refactor", type: "ai-task", instructions: "Read the code in $target_path. Identify code smells, duplication, and areas for improvement. Refactor the code following best practices: extract functions, improve naming, reduce complexity, and add types where missing. Keep behavior identical.", inputs: [], outputs: ["refactored"], requires_tools: [], position: { x: 0, y: 0 } },
        { id: "t8-n2", name: "Run Tests", type: "shell", instructions: "npm test", inputs: [], outputs: [], requires_tools: [], position: { x: 300, y: 0 } },
        { id: "t8-n3", name: "Commit", type: "git", instructions: "git add -A && git commit -m \"refactor: improve $target_path\"", inputs: [], outputs: [], requires_tools: [], position: { x: 600, y: 0 } },
      ],
      edges: [
        { id: "t8-e1", from: "t8-n1", to: "t8-n2", condition: "success" },
        { id: "t8-e2", from: "t8-n2", to: "t8-n3", condition: "success" },
      ],
    },
  },
];
