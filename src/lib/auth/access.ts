/**
 * Whether this deployment asks people to sign in. Off by default: the apps are
 * open to anyone with the address. Set REQUIRE_SIGN_IN=true to bring back
 * sign-in (and, with INVITE_CODE, invitation links). Read at build time for
 * the page and at request time for the proxy and the ask route; redeploy after
 * changing it.
 */
export function signInRequired(value = process.env.REQUIRE_SIGN_IN): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
