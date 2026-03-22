import { NextResponse } from 'next/server';
import { roomService } from '@/lib/server-utils';
import { AgentDispatchClient } from 'livekit-server-sdk';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { prompt, modelProvider, voice } = body;

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        const livekitUrl = process.env.LIVEKIT_URL;

        if (!apiKey || !apiSecret || !livekitUrl) {
            return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
        }

        // Unique room name for this VoIP session
        const roomName = `voip-${Date.now()}-${Math.floor(Math.random() * 9999)}`;

        // Metadata for the agent – no phone_number means agent skips SIP dial-out
        const metadata = JSON.stringify({
            mode: 'voip',                              // signals browser session
            user_prompt: prompt || '',
            model_provider: modelProvider || 'openai',
            voice_id: voice || 'alloy',
        });

        // Create the room first with metadata so the agent picks it up
        await roomService.createRoom({
            name: roomName,
            metadata,
            emptyTimeout: 60 * 10, // 10 min idle timeout
        });

        // Dispatch the agent worker into this room explicitly
        const dispatchClient = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);
        const dispatch = await dispatchClient.createDispatch(roomName, 'outbound-caller', {
            metadata,
        });

        return NextResponse.json({
            success: true,
            roomName,
            dispatchId: dispatch.id,
        });

    } catch (error: any) {
        console.error('VoIP dispatch error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
