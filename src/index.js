import fs from 'node:fs'
import path from 'node:path'

import babel from '@babel/core'
import t from '@babel/types'
import traverse from '@babel/traverse'
import generate from '@babel/generator'

function isRequireCallExpression(node) {
  const isRequire = t.isIdentifier(node.callee, { name: 'require' }) && node.arguments.length === 1

  if (!isRequire) {
    return false
  }

  const arg = node.arguments[0]

  if (t.isStringLiteral(arg)) {
    return {
      type: 'static',
      requireId: arg.value
    }
  } 
  return {
    type: 'dynamic',
    requireId: arg.name
  }
  
}

function isStaticRequireCallExpression(node) {
  return t.isCallExpression(node) &&
    t.isIdentifier(node.callee, { name: 'require' }) &&
    node.arguments.length === 1 &&
    t.isStringLiteral(node.arguments[0])
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

function isDynamicRequireCallExpression(node) {
  return t.isCallExpression(node) &&
    t.isIdentifier(node.callee, { name: 'require' }) &&
    node.arguments.length === 1 &&
    t.isIdentifier(node.arguments[0])
}

function getRequireArg(node) {
  if (isStaticRequireCallExpression(node)) {
    return node.arguments[0].value
  }
  return node.arguments[0].name

}

export function transformCjsToEsm(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8')

  const ast = babel.parse(code)
  const requirePaths = []

  traverse(ast, {
    VariableDeclaration(traversePath) {
      const declarations = traversePath.node.declarations

      if (declarations.length === 1) {
        const declaration = declarations[0]
        const id = declaration.id
        const init = declaration.init

        if (!isRequireCallExpression(init)) {
          return
        }

        const { type, requireId } = isRequireCallExpression(init)
        const { completedRequirePath, isLocalModule } = completeRequirePath(path.dirname(filePath), requireId)

        if (isLocalModule) {
          requirePaths.push(completedRequirePath)
        }

        if (type === 'static') {
          if (t.isIdentifier(id)) {
            /**
             * eg: 
             *  const fs = require("node:fs")
             */
            traversePath.replaceWith(
              t.importDeclaration(
                [t.importDefaultSpecifier(id)],
                t.stringLiteral(completedRequirePath)
              )
            )
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
          // 动态引入
        }


      } else {
        const needDelete = []
        for (let i = 0; i < declarations.length; i++) {
          const declaration = declarations[i]
          const id = declaration.id
          const init = declaration.init

          if (!init || !isRequireCallExpression(init)) {
            continue
          }

          const { type, requireId } = isRequireCallExpression(init)
          const { completedRequirePath, isLocalModule } = completeRequirePath(path.dirname(filePath), requireId)

          if (isLocalModule) {
            requirePaths.push(completedRequirePath)
          }

          if (type === 'static') {
            if (t.isIdentifier(id)) {
              traversePath.insertBefore(
                t.importDeclaration(
                  [t.importDefaultSpecifier(id)],
                  t.stringLiteral(completedRequirePath)
                )
              )
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
            // 动态引入
          }

        }

        traversePath.node.declarations = declarations.filter((_, i) => !needDelete.includes(i))
      }
    },
  });

  const res = generate(ast).code;

  return res
}
