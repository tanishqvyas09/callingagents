import { RoomServiceClient, SipClient } from 'livekit-server-sdk';

function getLiveKitClients() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    throw new Error("Missing LiveKit Credentials");
  }
  return {
    roomService: new RoomServiceClient(url, key, secret),
    sipClient: new SipClient(url, key, secret),
  };
}

export function getRoomService(): RoomServiceClient {
  return getLiveKitClients().roomService;
}

export function getSipClient(): SipClient {
  return getLiveKitClients().sipClient;
}

// Legacy exports for backward compatibility (lazy)
export const roomService = new Proxy({} as RoomServiceClient, {
  get(_target, prop) {
    return getLiveKitClients().roomService[prop as keyof RoomServiceClient];
  },
});

export const sipClient = new Proxy({} as SipClient, {
  get(_target, prop) {
    return getLiveKitClients().sipClient[prop as keyof SipClient];
  },
});
