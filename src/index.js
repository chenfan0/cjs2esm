import fs from 'node:fs'
import path from 'node:path'

import babel from '@babel/core'
import t from '@babel/types'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import template from '@babel/template'

function isRequire(node) {
  if (!node) return false

  if (t.isCallExpression(node)) {
    const callee = node.callee

    if (t.isIdentifier(callee, { name: 'require' }) && node.arguments.length === 1) {
      const arg = node.arguments[0]

      if (t.isStringLiteral(arg)) {
        return {
          isStaticRequire: true,
          requireId: arg.value,
          type: 'callExpression'
        }
      } 
      return {
        isStaticRequire: false,
        requireId: arg.name,
        type: 'callExpression'
      }
    }

    if (t.isCallExpression(callee) && t.isIdentifier(callee.callee, { name: 'require' }) && callee.arguments.length === 1) {
      const arg = callee.arguments[0]
      return {
        isStaticRequire: true,
        requireId: arg.value,
        type: 'callExpression',
        callArguments: node.arguments
      }

    }

  }

  if (t.isMemberExpression(node)) {
    const object = node.object
    const property = node.property

    if (t.isCallExpression(object) && t.isIdentifier(object.callee, { name: 'require' }) && object.arguments.length === 1) {
      const arg = object.arguments[0]
      return {
        isStaticRequire: true,
        requireId: arg.value,
        type: 'memberExpression',
        property: property.name
      }
    }

    // TODO: nested member expression

  }

  return false
  
}

function isTopLevelRequire(traversePath) {
  return traversePath.findParent((p) => p.isProgram()) === traversePath.parentPath
}

function completeRequirePath(basePath, requirePath) {
  /**
   * eg:
   *  node:path -> node:path
   *  dayjs -> dayjs
   *  . -> ./index.js
   *  ./ -> ./index.js
   *  ../ -> ../index.js
   *  ./file -> ./file.js or ./file/index.js
   * 
   */
  if (requirePath === '.') {
    const exist = fs.existsSync(path.resolve(basePath, 'index.js'))
    let completedRequirePath = '.'
    if (exist) {
      completedRequirePath = './index.js'
    }
    return {
      completedRequirePath,
      isLocalModule: true
    }
  } else if (
    requirePath.startsWith('./') 
    || 
    requirePath.startsWith('../')
  ) {
    const ext = path.extname(requirePath)
    if (!ext) {
      const exist = fs.existsSync(path.resolve(basePath, requirePath + '.js'))
      let completedRequirePath = requirePath
      if (exist) {
        completedRequirePath = requirePath + '.js'
      } else {
        const existDir = fs.existsSync(path.resolve(basePath, requirePath, 'index.js'))
        if (existDir) {
          completedRequirePath = path.join(requirePath, 'index.js')
        }
      }
      return {
        completedRequirePath,
        isLocalModule: true
      }
    } else {
      return {
        completedRequirePath: requirePath,
        isLocalModule: true
      }
    }
  } else {
    return {
      completedRequirePath: requirePath,
      isLocalModule: false
    }
  }
}

export function transformCjsToEsm(code, filePath = process.cwd()) {
  const ast = babel.parse(code)

  const requirePaths = []

  let use__dirname = false
  let use__filename = false
  let alreadyDefinedFileURLToPath = false
  let alreadyDefinedDirname = false

  traverse(ast, {
    VariableDeclaration(traversePath) {
      const declarations = traversePath.node.declarations

      if (declarations.length === 1) {
        const declaration = declarations[0]
        const id = declaration.id
        const init = declaration.init

        if (!isRequire(init)) {
          return
        }

        if (!isTopLevelRequire(traversePath)) {
          t.addComment(traversePath.node, 'leading', ' [dynamic require] ')
          return
        }

        const { isStaticRequire, requireId, type, property, callArguments } = isRequire(init)
        const { completedRequirePath, isLocalModule } = completeRequirePath(path.dirname(filePath), requireId)

        if (isLocalModule) {
          requirePaths.push(completedRequirePath)
        }

        if (isStaticRequire) {
          if (t.isIdentifier(id)) {
            /**
             * eg: 
             *  const fs = require("node:fs")
             *  -> import fs from "node:fs"
             * 
             *  const promises = require("fs").promises
             *  -> import { promises } from "fs"
             */

            if (type === 'callExpression') {

              if (callArguments) {
                // const fs = require('fs')()
                //  -> import fsFactory from 'fs'
                //  -> const fs = fsFactory()

                const factoryId = t.identifier(id.name + 'Factory')
                const factoryImportDeclaration = t.importDeclaration(
                  [t.importDefaultSpecifier(factoryId)],
                  t.stringLiteral(completedRequirePath)
                )

                traversePath.insertBefore(factoryImportDeclaration)
                traversePath.replaceWith(
                  t.variableDeclaration('const', [t.variableDeclarator(id, t.callExpression(factoryId, callArguments))])
                )

              } else {

                traversePath.replaceWith(
                  t.importDeclaration(
                    [t.importDefaultSpecifier(id)],
                    t.stringLiteral(completedRequirePath)
                  )
                )
              }
            }

            if (type === 'memberExpression') {
              if (id.name === property) {
                traversePath.replaceWith(
                  t.importDeclaration(
                    [t.importSpecifier(id, t.identifier(property))],
                    t.stringLiteral(completedRequirePath)
                  )
                )
              } else {
                traversePath.replaceWith(
                  t.importDeclaration(
                    [t.importSpecifier(id, t.identifier(property))],
                    t.stringLiteral(completedRequirePath)
                  )
                )
              }
            }

          } else if (t.isObjectPattern(id)) {
            /**
             * eg:
             *  const { port: port1, name1 } = require('../../config')
             */
            const properties = id.properties
            const specifiers = properties.map(property => {
              return t.importSpecifier(property.value, property.key)
            })
            traversePath.replaceWith(
              t.importDeclaration(
                specifiers,
                t.stringLiteral(completedRequirePath)
              )
            )
          } 

        } else {
          /**
           * dynamic require
           * eg: 
           *  const requirePath = './' + 'config'
           *  const config = require(requirePath)
           */
          t.addComment(traversePath.node, 'leading', ' [dynamic require] ')
        }


      } else {
        const needDelete = []
        for (let i = 0; i < declarations.length; i++) {
          const declaration = declarations[i]
          const id = declaration.id
          const init = declaration.init

          if (!isRequire(init)) {
            continue
          }

          const { isStaticRequire, requireId, type, property } = isRequire(init)
          const { completedRequirePath, isLocalModule } = completeRequirePath(path.dirname(filePath), requireId)

          if (isLocalModule) {
            requirePaths.push(completedRequirePath)
          }

          if (isStaticRequire) {
            if (t.isIdentifier(id)) {
              if (type === 'callExpression') {
                traversePath.insertBefore(
                  t.importDeclaration(
                    [t.importDefaultSpecifier(id)],
                    t.stringLiteral(completedRequirePath)
                  )
                )
              }
  
              if (type === 'memberExpression') {
                if (id.name === property) {
                  traversePath.insertBefore(
                    t.importDeclaration(
                      [t.importSpecifier(id, t.identifier(property))],
                      t.stringLiteral(completedRequirePath)
                    )
                  )
                } else {
                  traversePath.insertBefore(
                    t.importDeclaration(
                      [t.importSpecifier(id, t.identifier(property))],
                      t.stringLiteral(completedRequirePath)
                    )
                  )
                }
              }
             
              needDelete.push(i)
            } else if (t.isObjectPattern(id)) {
              const properties = id.properties
              const specifiers = properties.map(property => {
                return t.importSpecifier(property.value, property.key)
              })
              traversePath.insertBefore(
                t.importDeclaration(
                  specifiers,
                  t.stringLiteral(completedRequirePath)
                )
              )
              needDelete.push(i)
            }
          } else {
            // 
            t.addComment(traversePath.node, 'leading', ' [dynamic require] ')
          }

        }

        traversePath.node.declarations = declarations.filter((_, i) => !needDelete.includes(i))
      }
    },

    // ExpressionStatement(traversePath) {
    //   const expression = traversePath.node.expression

    //   const left = expression.left
    //   const right = expression.right

    //   if (!t.isMemberExpression(left)) {
    //     return
    //   }

    //   if (left.object.name !== 'module') {
    //     return
    //   }

    //   if (left.property.name !== 'exports') {
    //     return
    //   }

    //   if (t.isObjectExpression(right)) {

    //     traversePath.replaceWith(
    //       t.exportDefaultDeclaration(right)
    //     )
    //   }

    // },

    // ExpressionStatement(path) {
    //   if (t.isAssignmentExpression(path.node.expression) &&
    //       t.isMemberExpression(path.node.expression.left) &&
    //       path.node.expression.left.object.name === 'module' &&
    //       path.node.expression.left.property.name === 'exports') {
        
    //     const rightNode = path.node.expression.right;
        
    //     if (t.isObjectExpression(rightNode)) {
    //       const exportNames = [];
    //       const declarations = [];
          
    //       rightNode.properties.forEach(prop => {
    //         if (t.isObjectProperty(prop)) {
    //           const key = prop.key.name;
    //           const value = prop.value;
            
    //            console.log(path.scope.hasBinding(key), key, value)
    //           const localName = path.scope.generateUidIdentifier(key).name;
              
    //           declarations.push(
    //             t.variableDeclaration('const', [
    //               t.variableDeclarator(t.identifier(localName), value)
    //             ])
    //           );
              
    //           exportNames.push(t.exportSpecifier(t.identifier(localName), t.identifier(key)));
    //         }
    //       });
          
    //       path.insertBefore([
    //         ...declarations,
    //         t.exportNamedDeclaration(null, exportNames)
    //       ]);

    //       path.replaceWith(t.exportDefaultDeclaration(rightNode))
          
    //     } else {
    //       const localName = path.scope.generateUidIdentifier('default').name;
          
    //       path.replaceWithMultiple([
    //         t.variableDeclaration('const', [
    //           t.variableDeclarator(t.identifier(localName), rightNode)
    //         ]),
    //         t.exportDefaultDeclaration(t.identifier(localName))
    //       ]);
    //     }
    //   }
    // },

    AssignmentExpression(traversePath) {
      const left = traversePath.node.left
      const right = traversePath.node.right
      if (
        t.isMemberExpression(left) 
        && 
        t.isIdentifier(left.object, { name: 'module' })
        &&
        t.isIdentifier(left.property, { name: 'exports' })
      ) {

        if (t.isObjectExpression(right)) {
          const exportNames = [];
          const declarations = [];

          
          
          right.properties.forEach(prop => {
            if (t.isObjectProperty(prop)) {
              const key = prop.key.name;
              const value = prop.value;
              
              exportNames.push(t.exportSpecifier(t.identifier(value.name), t.identifier(key)));
            }
          });
          
          traversePath.insertBefore([
            ...declarations,
            t.exportNamedDeclaration(null, exportNames)
          ]);

          traversePath.insertBefore(t.exportDefaultDeclaration(right))
          traversePath.remove()
        }

      }
    },
    
    Identifier(traversePath) {
      const name = traversePath.node.name

      if (name === '__dirname') {
        use__dirname = true
      }

      if (name === '__filename') {
        use__filename = true
      }

      if (name === 'fileURLToPath') {
        alreadyDefinedFileURLToPath = true
      }

      if (name === 'dirname') {
        alreadyDefinedDirname = true
      }
    }
  });

  if (use__dirname && use__filename) {
    const buildFileURLToPath = template(`
      import { fileURLToPath ${ alreadyDefinedFileURLToPath ? 'as $$fileURLToPath' : '' } } from "node:url";
      import { dirname ${ alreadyDefinedDirname ? 'as $$dirname' : '' } } from "node:path"
      const __dirname = ${alreadyDefinedDirname ? '$$dirname' : 'dirname'}(${alreadyDefinedFileURLToPath ? '$$fileURLToPath' : 'fileURLToPath'}(import.meta.url));
      const __filename = ${alreadyDefinedFileURLToPath ? '$$fileURLToPath' : 'fileURLToPath'}(import.meta.url);
    `);
    const [
      fileURLToPathImportDeclaration, 
      dirnameImportDeclaration, 
      __dirnameVariableDeclaration, 
      __filenameVariableDeclaration
    ] = buildFileURLToPath();

    ast.program.body.unshift(__filenameVariableDeclaration);
    ast.program.body.unshift(__dirnameVariableDeclaration);
    ast.program.body.unshift(dirnameImportDeclaration);
    ast.program.body.unshift(fileURLToPathImportDeclaration);
  } else if (use__dirname) {
    const buildFileURLToPath = template(`
      import { fileURLToPath ${ alreadyDefinedFileURLToPath ? 'as $$fileURLToPath' : '' } } from "node:url";
      import { dirname ${ alreadyDefinedDirname ? 'as $$dirname' : '' } } from "node:path"
      const __dirname = ${alreadyDefinedDirname ? '$$dirname' : 'dirname'}(${alreadyDefinedFileURLToPath ? '$$fileURLToPath' : 'fileURLToPath'}(import.meta.url));
    `);
    const [
      fileURLToPathImportDeclaration, dirnameImportDeclaration, __dirnameVariableDeclaration] = buildFileURLToPath();

    ast.program.body.unshift(__dirnameVariableDeclaration);
    ast.program.body.unshift(dirnameImportDeclaration);
    ast.program.body.unshift(fileURLToPathImportDeclaration);

  } else if (use__filename) {
    const buildFileURLToPath = template(`
      import { fileURLToPath ${ alreadyDefinedFileURLToPath ? 'as $$fileURLToPath' : '' } } from "node:url";
      const __filename = ${alreadyDefinedFileURLToPath ? '$$fileURLToPath' : 'fileURLToPath'}(import.meta.url);
    `);
    const [fileURLToPathImportDeclaration, __filenameVariableDeclaration] = buildFileURLToPath();

    ast.program.body.unshift(__filenameVariableDeclaration);
    ast.program.body.unshift(fileURLToPathImportDeclaration);
  }


  const res = generate(ast).code;

  console.log(res)
  return res
}