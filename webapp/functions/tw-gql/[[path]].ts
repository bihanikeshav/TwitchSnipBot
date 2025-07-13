import { proxyTwitch } from '../_twitch-proxy';

// Routes /tw-gql/* → https://gql.twitch.tv/* (PlaybackAccessToken queries).
export const onRequest: PagesFunction = ({ request, params }) =>
  proxyTwitch(request, 'https://gql.twitch.tv', params.path);
