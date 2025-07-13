import { proxyTwitch } from '../_twitch-proxy';

// Routes /tw-usher/* → https://usher.ttvnw.net/* (HLS master playlists).
export const onRequest: PagesFunction = ({ request, params }) =>
  proxyTwitch(request, 'https://usher.ttvnw.net', params.path);
