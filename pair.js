import express from 'express';
import fs from 'fs';
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

    /*
     * Session directory.
     */
    let dirs = './' + num;

    /*
     * Remove an unfinished previous session.
     */
    removeFile(dirs);

    /*
     * Clean phone number.
     */
    num = String(num).replace(/[^0-9]/g, '');

    /*
     * Validate phone number.
     */
    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).json({
            success: false,
            error:
                'Invalid phone number. Please enter your full international number without + or spaces.'
        });
    }

    /*
     * Normalize to international format.
     */
    num = phone
        .getNumber('e164')
        .replace('+', '');

    /*
    |--------------------------------------------------------------------------
    | INITIATE SESSION
    |--------------------------------------------------------------------------
    */

    async function initiateSession() {

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(dirs);

        try {

            const {
                version
            } = await fetchLatestBaileysVersion();

            /*
             * IMPORTANT:
             * This configuration is kept the same as
             * your working version.
             */

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

            /*
            |--------------------------------------------------------------------------
            | SAVE CREDENTIAL UPDATES
            |--------------------------------------------------------------------------
            |
            | Register this immediately after creating the socket.
            */

            JinwooBot.ev.on(
                'creds.update',
                saveCreds
            );

            /*
            |--------------------------------------------------------------------------
            | CONNECTION EVENTS
            |--------------------------------------------------------------------------
            */

            JinwooBot.ev.on(
                'connection.update',
                async (update) => {

                    const {
                        connection,
                        lastDisconnect,
                        isNewLogin,
                        isOnline
                    } = update;

                    /*
                    |--------------------------------------------------------------------------
                    | CONNECTED
                    |--------------------------------------------------------------------------
                    */

                    if (connection === 'open') {

                        console.log(
                            '✅ JinwooBot connected successfully!'
                        );

                        console.log(
                            `📱 WhatsApp Number: ${num}`
                        );

                        try {

                            /*
                             * Give the authentication state
                             * time to finish saving.
                             */
                            await delay(2000);

                            /*
                             * Send safe confirmation.
                             */

                            const userJid =
                                jidNormalizedUser(
                                    `${num}@s.whatsapp.net`
                                );

                            await JinwooBot.sendMessage(
                                userJid,
                                {
                                    text:
`╭━━━〔 ⚔️ JINWOO BOT 〕━━━╮
┃
┃  ✅ *PAIRING SUCCESSFUL*
┃
┃  Your WhatsApp has been
┃  successfully connected
┃  to *JinwooBot*.
┃
┃  🤖 Bot: *JinwooBot*
┃  ⚡ Status: *Connected*
┃  🔐 Authentication: *Secured*
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

⚠️ *Security Notice*
Never share your WhatsApp
authentication credentials,
session files, or login codes
with anyone.

© 2026 Chris-Tech ✌︎㋡`
                                }
                            );

                            console.log(
                                '📨 JinwooBot confirmation sent.'
                            );

                        } catch (error) {

                            console.error(
                                '❌ Error sending confirmation:',
                                error
                            );
                        }

                        /*
                         * Keep the same cleanup behavior
                         * from your working implementation.
                         */

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

                    /*
                    |--------------------------------------------------------------------------
                    | NEW LOGIN
                    |--------------------------------------------------------------------------
                    */

                    if (isNewLogin) {

                        console.log(
                            '🔐 New login via pair code detected.'
                        );
                    }

                    /*
                    |--------------------------------------------------------------------------
                    | ONLINE
                    |--------------------------------------------------------------------------
                    */

                    if (isOnline) {

                        console.log(
                            '📶 JinwooBot client is online.'
                        );
                    }

                    /*
                    |--------------------------------------------------------------------------
                    | CONNECTION CLOSED
                    |--------------------------------------------------------------------------
                    */

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

                        /*
                         * Preserve the original reconnect behavior.
                         */

                        initiateSession();
                    }
                }
            );

            /*
            |--------------------------------------------------------------------------
            | REQUEST PAIRING CODE
            |--------------------------------------------------------------------------
            */

            if (
                !JinwooBot.authState
                    ?.creds
                    ?.registered
            ) {

                /*
                 * Give WhatsApp time to initialize.
                 */

                await delay(3000);

                /*
                 * Ensure only digits are passed.
                 */

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

                    /*
                     * Format pairing code.
                     */

                    code =
                        code
                            ?.match(/.{1,4}/g)
                            ?.join('-') ||
                        code;

                    console.log({
                        number: pairingNumber,
                        code
                    });

                    /*
                     * Return pairing code to frontend.
                     */

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