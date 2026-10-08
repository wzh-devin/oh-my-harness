import { CHAT_ROUTE_KIND } from '@oh-my-harness/shared'

export type ChatRoute =
  | { kind: typeof CHAT_ROUTE_KIND.EXPLORE }
  | { kind: typeof CHAT_ROUTE_KIND.LIBRARY }
  | { kind: typeof CHAT_ROUTE_KIND.NEW }
  | { kind: typeof CHAT_ROUTE_KIND.THREAD; threadId: string }

/** 将浏览器路径解析为聊天应用内部路由，不接受嵌套或外部地址。 */
export const resolveChatRoute = (pathname: string): ChatRoute => {
  const segment = pathname.replace(/^\/+/, '').split('/')[0] ?? ''

  if (segment === CHAT_ROUTE_KIND.NEW) return { kind: CHAT_ROUTE_KIND.NEW }
  if (segment === CHAT_ROUTE_KIND.LIBRARY)
    return { kind: CHAT_ROUTE_KIND.LIBRARY }
  if (segment === CHAT_ROUTE_KIND.EXPLORE)
    return { kind: CHAT_ROUTE_KIND.EXPLORE }

  return { kind: CHAT_ROUTE_KIND.THREAD, threadId: segment }
}
