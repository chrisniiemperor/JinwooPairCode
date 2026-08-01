import express from 'express';
import fs from 'fs';
import zlib from 'zlib';
import pino from 'pino';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import pn from 'awesome-phonenumber';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| SESSION ID STORE (in-memory, keyed by phone number)
|--------------------------------------------------------------------------
*/
const sessionStore = new Map();

/*
|--------------------------------------------------------------------------
| SESSION CLEANUP
|--------------------------------------------------------------------------
*/

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return false;
        }

        fs.rmSync(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (error) {
        console.error(
            '❌ Error removing session:',
            error
        );

        return false;
    }
}

/*
|--------------------------------------------------------------------------
| PAIRING ROUTE
|--------------------------------------------------------------------------
*/

router.get('/', async (req, res) => {

    let num = req.query.number;

    if (!num) {
        return res.status(400).json({
            success: false,
            error: 'WhatsApp number is required.'
        });
    }

    let dirs = './' + num;

    removeFile(dirs);

    num = String(num).replace(/[^0-9]/g, '');

    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).json({
            success: false,
            error:
                'Invalid phone number. Please enter your full international number without + or spaces.'
        });
    }

    num = phone
        .getNumber('e164')
        .replace('+', '');

    async function initiateSession() {

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(dirs);

        try {

            const {
                version
            } = await fetchLatestBaileysVersion();

            const JinwooBot = makeWASocket({

                version,

                auth: {
                    creds: state.creds,

                    keys:
                        makeCacheableSignalKeyStore(
                            state.keys,
                            pino({
                                level: 'fatal'
                            }).child({
                                level: 'fatal'
                            })
                        )
                },

                printQRInTerminal: false,

                logger:
                    pino({
                        level: 'fatal'
                    }).child({
                        level: 'fatal'
                    }),

                browser:
                    Browsers.windows('Chrome'),

                markOnlineOnConnect: false,

                generateHighQualityLinkPreview: false,

                defaultQueryTimeoutMs: 60000,

                connectTimeoutMs: 60000,

                keepAliveIntervalMs: 30000,

                retryRequestDelayMs: 250,

                maxRetries: 5
            });

            JinwooBot.ev.on(
                'creds.update',
                saveCreds
            );

            JinwooBot.ev.on(
                'connection.update',
                async (update) => {

                    const {
                        connection,
                        lastDisconnect,
                        isNewLogin,
                        isOnline
                    } = update;

                    if (connection === 'open') {

                        console.log(
                            '✅ JinwooBot connected successfully!'
                        );

                        console.log(
                            `📱 WhatsApp Number: ${num}`
                        );

                        try {

                            await delay(2000);

                            const userJid =
                                jidNormalizedUser(
                                    `${num}@s.whatsapp.net`
                                );

                            /*
                             * Read creds.json, gzip + base64
                             * encode it, then prepend the
                             * JinwooBot! prefix so the bot
                             * can decode it via config.js.
                             */
                            const credsPath = `${dirs}/creds.json`;
                            const credsData = fs.readFileSync(credsPath);
                            const compressed = zlib.gzipSync(credsData);
                            const sessionID = 'JinwooBot!' + compressed.toString('base64');

                            console.log('🔑 Session ID generated successfully.');

                            /*
                             * 1) Send the success banner.
                             */
                            await JinwooBot.sendMessage(
                                userJid,
                                {
                                    text:
`╭━━━〔 ⚔️ JINWOO BOT 〕━━━╮
┃
┃  ✅ *PAIRING SUCCESSFUL*
┃
┃  🤖 Bot: *JinwooBot*
┃  ⚡ Status: *Connected*
┃  🔐 Authentication: *Secured*
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

📋 Your *Session ID* is in the
next message.

👇 *Tap & hold it → Copy*
then paste it into *config.js*
as the value of *sessionID*,
or set it as the *SESSION_ID*
environment variable.

⚠️ Never share this with anyone.

© 2026 Chris-Tech ✌︎㋡`
                                }
                            );

                            /*
                             * 2) Send the session ID alone so
                             *    the user can tap-and-hold to
                             *    copy it cleanly.
                             */
                            await JinwooBot.sendMessage(
                                userJid,
                                { text: sessionID }
                            );

                            console.log(
                                '📨 Session ID sent to user.'
                            );

                        } catch (error) {

                            console.error(
                                '❌ Error sending session ID:',
                                error
                            );
                        }

                        console.log(
                            '🧹 Cleaning up pairing session...'
                        );

                        await delay(1000);

                        removeFile(dirs);

                        console.log(
                            '✅ Pairing process completed.'
                        );

                        return;
                    }

                    if (isNewLogin) {

                        console.log(
                            '🔐 New login via pair code detected.'
                        );
                    }

                    if (isOnline) {

                        console.log(
                            '📶 JinwooBot client is online.'
                        );
                    }

                    if (connection === 'close') {

                        const statusCode =
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode;

                        if (statusCode === 401) {

                            console.log(
                                '❌ WhatsApp logged out. A new pairing code is required.'
                            );

                            return;
                        }

                        console.log(
                            '🔁 Connection closed — restarting...'
                        );

                        initiateSession();
                    }
                }
            );

            if (
                !JinwooBot.authState
                    ?.creds
                    ?.registered
            ) {

                await delay(3000);

                let pairingNumber =
                    num.replace(/[^\d+]/g, '');

                if (
                    pairingNumber.startsWith('+')
                ) {
                    pairingNumber =
                        pairingNumber.substring(1);
                }

                try {

                    console.log(
                        `📱 Requesting JinwooBot pairing code for ${pairingNumber}`
                    );

                    let code =
                        await JinwooBot.requestPairingCode(
                            pairingNumber
                        );

                    code =
                        code
                            ?.match(/.{1,4}/g)
                            ?.join('-') ||
                        code;

                    console.log({
                        number: pairingNumber,
                        code
                    });

                    if (!res.headersSent) {

                        return res.json({

                            success: true,

                            registered: false,

                            code,

                            number: pairingNumber,

                            message:
                                'Enter this code in WhatsApp → Linked Devices → Link with phone number.'
                        });
                    }

                } catch (error) {

                    console.error(
                        '❌ Error requesting pairing code:',
                        error
                    );

                    if (!res.headersSent) {

                        return res.status(503).json({

                            success: false,

                            error:
                                'Failed to get pairing code. Please check your phone number and try again.'
                        });
                    }
                }
            }

        } catch (error) {

            console.error(
                '❌ Error initializing JinwooBot session:',
                error
            );

            if (!res.headersSent) {

                return res.status(503).json({

                    success: false,

                    error:
                        'Service Unavailable'
                });
            }
        }
    }

    await initiateSession();
});

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

process.on(
    'uncaughtException',
    (err) => {

        const message =
            String(err).toLowerCase();

        const ignoredErrors = [
            'conflict',
            'not-authorized',
            'socket connection timeout',
            'rate-overlimit',
            'connection closed',
            'timed out',
            'value not found',
            'stream errored',
            'stream errored (restart required)',
            'statuscode: 515',
            'statuscode: 503'
        ];

        if (
            ignoredErrors.some(
                pattern =>
                    message.includes(pattern)
            )
        ) {
            return;
        }

        console.error(
            'Caught exception:',
            err
        );
    }
);

export default router;