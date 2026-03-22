import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { roomName, participantName } = body;

        if (!roomName || !participantName) {
            return NextResponse.json({ error: 'roomName and participantName are required' }, { status: 400 });
        }

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        const livekitUrl = process.env.LIVEKIT_URL;

        if (!apiKey || !apiSecret || !livekitUrl) {
            return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
        }

        // Create a short-lived token (1 hour) for the browser participant
        const at = new AccessToken(apiKey, apiSecret, {
            identity: participantName,
            ttl: '1h',
        });

        at.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,       // Allow mic
            canSubscribe: true,     // Allow hearing agent
            canPublishData: true,   // Allow data channel (transcripts)
        });

        const token = await at.toJwt();

        return NextResponse.json({ token, url: livekitUrl });

    } catch (error: any) {
        console.error('Token error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
