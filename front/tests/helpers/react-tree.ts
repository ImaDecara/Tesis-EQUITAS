import { isValidElement, type ReactNode } from 'react'

export function textFromReactTree(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => textFromReactTree(child)).join(' ')
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromReactTree(node.props.children)
  }

  return ''
}
