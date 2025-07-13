import { proxyAbsolute } from './_twitch-proxy';

// Routes /tw-media?u=<encoded twitch cdn url> → that url, with twitch
// Origin/Referer so Twitch's media hosts don't 403 a non-twitch origin.
export const onRequest: PagesFunction = ({ request }) => proxyAbsolute(request);
