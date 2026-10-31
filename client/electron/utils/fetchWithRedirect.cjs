const MAX_REDIRECTS = 5;

// 仅跟随同源重定向；跨域跳转会泄露 Authorization，必须拒绝。
// 307/308 原样重发方法和请求体；303 及 POST 的 301/302 按规范改为不带请求体的 GET。
async function fetchWithRedirect(url, init = {}, fetchImpl = fetch) {
  let currentUrl = String(url);
  let currentInit = { ...init, redirect: 'manual' };
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImpl(currentUrl, currentInit);
    const location = response.headers.get('location');
    if (response.status < 301 || response.status > 308 || response.status === 304 || !location || redirects >= MAX_REDIRECTS) {
      return response;
    }
    const method = String(currentInit.method || 'GET').toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      const { body, ...rest } = currentInit;
      currentInit = { ...rest, method: 'GET' };
    }
    await response.body?.cancel().catch(() => undefined);
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== new URL(currentUrl).origin) throw new Error('模型服务重定向到其他地址；已拒绝跨域转发认证信息');
    currentUrl = nextUrl.href;
  }
}

module.exports = { fetchWithRedirect };
