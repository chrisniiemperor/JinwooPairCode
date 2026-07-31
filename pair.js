import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';

import pn from 'awesome-phonenumber';

const router = express.Router();

const logger = pino({
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info'
});

/*
|--------------------------------------------------------------------------
| Session directory
|--------------------------------------------------------------------------
*/

const SESSION_ROOT = path.join(process.cwd(), 'sessions');

if (!fs.existsSync(SESSION_ROOT)) {
    fs.mkdirSync(SESSION_ROOT, {
        recursive: true
    });
}

/*
|--------------------------------------------------------------------------
| Remove session
|--------------------------------------------------------------------------
*/

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, {
                recursive: true,
                force: true
            });
        }
    } catch (error) {
        console.error('Session cleanup error:', error);
    }
}

/*
|--------------------------------------------------------------------------
| Pair route
|--------------------------------------------------------------------------
*/

router.get('/', async (req, res) => {

    let num = String(req.query.number || '');

    /*
    |--------------------------------------------------------------------------
    | Clean number
    |--------------------------------------------------------------------------
    */

    num = num.replace(/\D/g, '');

    if (!num) {
        return res.status(400).json({
            code: 'Please provide a WhatsApp number.'
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate number
    |--------------------------------------------------------------------------
    */

    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).json({
            code: 'Invalid WhatsApp number. Use the full international number.'
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Normalize E.164
    |--------------------------------------------------------------------------
    */

    num = phone
        .getNumber('e164')
        .replace('+', '');

    /*
    |--------------------------------------------------------------------------
    | Unique session directory
    |--------------------------------------------------------------------------
    */

    const sessionDir = path.join(
        SESSION_ROOT,
        num
    );

    /*
    |--------------------------------------------------------------------------
    | Remove old temporary session
    |--------------------------------------------------------------------------
    */

    if (fs.existsSync(sessionDir)) {
        removeFile(sessionDir);
    }

    /*
    |--------------------------------------------------------------------------
    | Start WhatsApp session
    |--------------------------------------------------------------------------
    */

    try {

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(
            sessionDir
        );

        const {
            version
        } = await fetchLatestBaileysVersion();

        console.log(
            `🔌 Starting JinwooBot session for ${num}`
        );

        const JinwooBot = makeWASocket({

            version,

            logger: pino({
                level: 'silent'
            }),

            printQRInTerminal: false,

            auth: {
                creds: state.creds,

                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({
                        level: 'silent'
                    })
                )
            },

            browser: Browsers.windows(
                'Chrome'
            ),

            markOnlineOnConnect: false,

            generateHighQualityLinkPreview: false,

            defaultQueryTimeoutMs: 60000,

            connectTimeoutMs: 60000,

            keepAliveIntervalMs: 30000,

            retryRequestDelayMs: 250,

            maxRetries: 5
        });

        /*
        |--------------------------------------------------------------------------
        | IMPORTANT: Save credentials
        |--------------------------------------------------------------------------
        */

        JinwooBot.ev.on(
            'creds.update',
            async () => {

                try {

                    await saveCreds();

                    console.log(
                        '💾 Credentials saved'
                    );

                } catch (error) {

                    console.error(
                        '❌ Failed to save credentials:',
                        error
                    );

                }

            }
        );

        /*
        |--------------------------------------------------------------------------
        | Connection updates
        |--------------------------------------------------------------------------
        */

        JinwooBot.ev.on(
            'connection.update',
            async update => {

                const {
                    connection,
                    lastDisconnect,
                    isNewLogin
                } = update;

                console.log(
                    '📡 WhatsApp connection:',
                    connection
                );

                /*
                |--------------------------------------------------------------------------
                | New login detected
                |--------------------------------------------------------------------------
                */

                if (isNewLogin) {

                    console.log(
                        '🔐 New JinwooBot login detected'
                    );

                }

                /*
                |--------------------------------------------------------------------------
                | Successfully connected
                |--------------------------------------------------------------------------
                */

                if (connection === 'open') {

                    console.log(
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
                    );

                    console.log(
                        '✅ JINWOOBOT CONNECTED'
                    );

                    console.log(
                        `📱 Number: ${num}`
                    );

                    console.log(
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
                    );

                    /*
                    |--------------------------------------------------------------------------
                    | Send welcome message
                    |--------------------------------------------------------------------------
                    */

                    try {

                        const jid =
                            `${num}@s.whatsapp.net`;

                        await JinwooBot.sendMessage(
                            jid,
                            {
                                text:
`╭━━━〔 ⚔️ JINWOO MINI-BOT 〕━━━╮

   🖤 SHADOW SYSTEM ONLINE

Hello, Shadow Monarch.

Your WhatsApp device has been
successfully linked to Jinwoo Mini-Bot.

⚡ System Status: ONLINE
🛡️ Connection: SECURE
👑 Mode: SHADOW NETWORK

Please keep your session credentials
private and never share them.

╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

© 2026 Chris▪︎Tech`
                            }
                        );

                        console.log(
                            '📨 Welcome message sent'
                        );

                    } catch (error) {

                        console.error(
                            '⚠️ Welcome message failed:',
                            error.message
                        );

                    }

                    /*
                    |--------------------------------------------------------------------------
                    | IMPORTANT
                    |--------------------------------------------------------------------------
                    |
                    | DO NOT DELETE sessionDir here.
                    |
                    | The credentials are required to keep
                    | the WhatsApp account linked.
                    |
                    |--------------------------------------------------------------------------
                    */

                    console.log(
                        `💾 Session retained at: ${sessionDir}`
                    );
                }

                /*
                |--------------------------------------------------------------------------
                | Connection closed
                |--------------------------------------------------------------------------
                */

                if (connection === 'close') {

                    const statusCode =
                        lastDisconnect
                            ?.error
                            ?.output
                            ?.statusCode;

                    console.log(
                        '❌ Connection closed'
                    );

                    console.log(
                        'Status:',
                        statusCode
                    );

                    /*
                    |--------------------------------------------------------------------------
                    | Logged out
                    |--------------------------------------------------------------------------
                    */

                    if (
                        statusCode ===
                        DisconnectReason.loggedOut ||
                        statusCode === 401
                    ) {

                        console.log(
                            '🚪 WhatsApp session logged out'
                        );

                        removeFile(
                            sessionDir
                        );

                        return;
                    }

                    /*
                    |--------------------------------------------------------------------------
                    | Temporary connection failure
                    |--------------------------------------------------------------------------
                    */

                    console.log(
                        '🔄 Temporary connection failure.'
                    );

                    console.log(
                        'Session credentials will be retained.'
                    );
                }

            }
        );

        /*
        |--------------------------------------------------------------------------
        | Request pairing code
        |--------------------------------------------------------------------------
        */

        if (
            !JinwooBot.authState.creds.registered
        ) {

            /*
            |--------------------------------------------------------------------------
            | Small delay before pairing request
            |--------------------------------------------------------------------------
            */

            await delay(3000);

            try {

                console.log(
                    `🔑 Requesting pairing code for ${num}`
                );

                let code =
                    await JinwooBot.requestPairingCode(
                        num
                    );

                /*
                |--------------------------------------------------------------------------
                | Format code
                |--------------------------------------------------------------------------
                */

                code =
                    code
                        ?.match(/.{1,4}/g)
                        ?.join('-') ||
                    code;

                console.log(
                    '🔑 PAIRING CODE:',
                    code
                );

                /*
                |--------------------------------------------------------------------------
                | Send response to frontend
                |--------------------------------------------------------------------------
                */

                if (!res.headersSent) {

                    return res.json({
                        success: true,
                        code
                    });

                }

            } catch (error) {

                console.error(
                    '❌ Pairing code error:',
                    error
                );

                if (!res.headersSent) {

                    return res.status(503).json({
                        success: false,
                        code:
                            'Failed to generate pairing code.'
                    });

                }

            }

        } else {

            console.log(
                'ℹ️ Existing authenticated session detected.'
            );

            if (!res.headersSent) {

                return res.json({
                    success: true,
                    code: null,
                    message:
                        'This session is already authenticated.'
                });

            }

        }

    } catch (error) {

        console.error(
            '❌ Failed to initialize JinwooBot:',
            error
        );

        /*
        |--------------------------------------------------------------------------
        | Cleanup failed session
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(sessionDir)
        ) {

            removeFile(
                sessionDir
            );

        }

        if (!res.headersSent) {

            return res.status(503).json({
                success: false,
                code:
                    'Unable to initialize WhatsApp session.'
            });

        }

    }

});


/*
|--------------------------------------------------------------------------
| Global error protection
|--------------------------------------------------------------------------
*/

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '⚠️ Unhandled rejection:',
            error
        );

    }
);

process.on(
    'uncaughtException',
    error => {

        console.error(
            '⚠️ Uncaught exception:',
            error
        );

    }
);


export default router;