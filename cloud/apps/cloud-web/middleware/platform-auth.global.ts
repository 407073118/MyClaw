const DEFAULT_AUTHENTICATED_PATH = "/hub";

function normalizeRedirect(value: unknown) {
  const target = Array.isArray(value) ? value[0] : value;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return "";
  }

  return target;
}

export default defineNuxtRouteMiddleware((to) => {
  const { isLoggedIn, isSessionValid, clearSession } = useCloudSession();
  const redirect = normalizeRedirect(to.query.redirect);
  const isAuthenticated = isLoggedIn.value && isSessionValid.value;

  if (to.path === "/") {
    return navigateTo(isAuthenticated ? DEFAULT_AUTHENTICATED_PATH : "/login");
  }

  if (!isLoggedIn.value && to.path !== "/login") {
    return navigateTo({
      path: "/login",
      query: {
        redirect: to.fullPath
      }
    });
  }

  if (!isSessionValid.value && isLoggedIn.value) {
    clearSession();
    if (to.path !== "/login") {
      return navigateTo({
        path: "/login",
        query: {
          redirect: to.fullPath
        }
      });
    }
  }

  if (isAuthenticated && (to.path === "/login" || to.path === "/console")) {
    return navigateTo(redirect || DEFAULT_AUTHENTICATED_PATH);
  }
});
