const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const jsDir = path.join(__dirname, 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

// We need to build a map of variable/function name -> file where it's declared
const exportsMap = {};

// First pass: collect all top-level declarations
const asts = {};
for (const file of files) {
  const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
  const ast = babel.parseSync(code, { sourceType: 'module' });
  asts[file] = { code, ast };
  
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration') {
      exportsMap[node.id.name] = file;
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          exportsMap[decl.id.name] = file;
        } else if (decl.id.type === 'ObjectPattern') {
          for (const prop of decl.id.properties) {
            if (prop.value && prop.value.type === 'Identifier') {
              exportsMap[prop.value.name] = file;
            }
          }
        }
      }
    }
  }
}

// Second pass: find undefined identifiers in each file that match an exported name
for (const file of files) {
  const { ast } = asts[file];
  
  // To find references to other files, we traverse the AST
  const dependencies = new Set();
  
  traverse(ast, {
    Identifier(pathPath) {
      const name = pathPath.node.name;
      // If it's a reference and not declared in the current scope
      if (pathPath.isReferencedIdentifier()) {
        if (!pathPath.scope.hasBinding(name) && exportsMap[name] && exportsMap[name] !== file) {
          dependencies.add(name);
        }
      }
    }
  });
  
  // Now group dependencies by source file
  const importsByFile = {};
  for (const dep of dependencies) {
    const sourceFile = exportsMap[dep];
    if (!importsByFile[sourceFile]) {
      importsByFile[sourceFile] = [];
    }
    importsByFile[sourceFile].push(dep);
  }
  
  // Transform AST to add export to top-level declarations
  for (const pathPath of ast.program.body) {
    if (pathPath.type === 'FunctionDeclaration' || pathPath.type === 'VariableDeclaration') {
      // Create an ExportNamedDeclaration
      const exportNode = {
        type: 'ExportNamedDeclaration',
        declaration: pathPath,
        specifiers: [],
        source: null
      };
      
      // Replace the original node with the export node
      // But we have to be careful with Babel traverse mutating
      // Actually we can just do this text-based since it's simpler
    }
  }
}

// Actually, text-based replacement is easier for adding exports and imports, to preserve comments exactly
for (const file of files) {
  const { code, ast } = asts[file];
  let lines = code.split('\n');
  
  const dependencies = new Set();
  traverse(ast, {
    Identifier(pathPath) {
      const name = pathPath.node.name;
      if (pathPath.isReferencedIdentifier() && !pathPath.scope.hasBinding(name)) {
        if (exportsMap[name] && exportsMap[name] !== file) {
          dependencies.add(name);
        }
      }
    }
  });
  
  const importsByFile = {};
  for (const dep of dependencies) {
    const sourceFile = exportsMap[dep];
    if (!importsByFile[sourceFile]) importsByFile[sourceFile] = [];
    importsByFile[sourceFile].push(dep);
  }
  
  // Generate import statements
  const importLines = [];
  for (const [sourceFile, deps] of Object.entries(importsByFile)) {
    // Sort dependencies for clean output
    deps.sort();
    importLines.push(`import { ${deps.join(', ')} } from './${sourceFile}';`);
  }
  
  // Add exports to top-level declarations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^(async\s+)?function\s+[a-zA-Z0-9_]+/)) {
      lines[i] = 'export ' + line;
    } else if (line.match(/^(const|let|var)\s+[a-zA-Z0-9_]+\s*=/)) {
      lines[i] = 'export ' + line;
    }
  }
  
  // Prepend imports
  if (importLines.length > 0) {
    lines = [...importLines, '', ...lines];
  }
  
  fs.writeFileSync(path.join(jsDir, file), lines.join('\n'));
}

console.log('ESM refactoring completed.');
