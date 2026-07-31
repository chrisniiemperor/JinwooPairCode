import express from "express";
import fs from "fs";
import path from "path";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";

const router = express.Router();

const logger = pino({
    level: process.env.NODE_ENV === "production"
        ? "info"
        : "debug"
});

const sessionsRoot = path.resolve(
    process.env.SESSION_DIR || "./sessions"
);

fs.mkdirSync(sessionsRoot, {
    recursive: true
});

const activeSessions = new Map();

function normalizeNumber(value) {
    return String(value || "")
        .replace(/\D/g, "");
}

function getSessionPath(number) {
    return path.join(
        sessionsRoot,
        number
    );
}

function removeSession(number) {
    const sessionPath =
        getSessionPath(number);

    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, {
                recursive: true,
                force: true
            });
        }
    } catch (error) {
        console.error(
            "Session cleanup error:",
            error
        );
    }
}

async function createSocket(number) {

    const sessionPath =
        getSessionPath(number);

    fs.mkdirSync(sessionPath, {
        recursive: true
    });

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(
        sessionPath
    );

    const {
        version,
        isLatest
    } = await fetchLatestBaileysVersion();

    console.log(
        `📦 Baileys: ${version.join(".")} | latest: ${isLatest}`
    );

    const socket =
        makeWASocket({

            version,

            auth: {
                creds: state.creds,

                keys:
                    makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
            },

            logger,

            printQRInTerminal: false,

            browser:
                Browsers.ubuntu(
                    "Chrome"
                ),

            markOnlineOnConnect: false,

            syncFullHistory: false,

            generateHighQualityLinkPreview: false,

            connectTimeoutMs: 60_000,

            defaultQueryTimeoutMs: 60_000,

            keepAliveIntervalMs: 20_000,

            retryRequestDelayMs: 500

        });

    /*
     * Save credentials immediately.
     */
    socket.ev.on(
        "creds.update",
        saveCreds
    );

    /*
     * Connection events.
     */
    socket.ev.on(
        "connection.update",
        async (update) => {

            const {
                connection,
                lastDisconnect,
                qr,
                isNewLogin
            } = update;

            console.log(
                "========== JINWOO CONNECTION =========="
            );

            console.log(
                JSON.stringify(
                    {
                        connection,
                        isNewLogin,
                        hasQR: Boolean(qr),
                        statusCode:
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode
                    },
                    null,
                    2
                )
            );

            console.log(
                "========================================"
            );

            /*
             * Successfully connected.
             */
            if (
                connection === "open"
            ) {

                console.log(
                    `✅ JINWOO BOT CONNECTED: ${number}`
                );

                /*
                 * IMPORTANT:
                 * Do NOT delete the session here.
                 */
                return;
            }

            /*
             * Connection closed.
             */
            if (
                connection === "close"
            ) {

                const statusCode =
                    lastDisconnect
                        ?.error
                        ?.output
                        ?.statusCode;

                console.log(
                    "❌ Connection closed:",
                    statusCode
                );

                /*
                 * Remove from active sessions.
                 */
                activeSessions.delete(
                    number
                );

                /*
                 * Only remove authentication
                 * when WhatsApp explicitly logged
                 * the account out.
                 */
                if (
                    statusCode ===
                    DisconnectReason.loggedOut
                ) {

                    console.log(
                        "🚪 WhatsApp session logged out."
                    );

                    removeSession(
                        number
                    );

                    return;
                }

                /*
                 * Do not recursively create sockets.
                 *
                 * Render/WhatsApp can reconnect
                 * independently when appropriate.
                 */
                console.log(
                    "ℹ️ Session closed without deleting credentials."
                );
            }

        }
    );

    return socket;
}


/*
|--------------------------------------------------------------------------
| PAIRING CODE
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    async (req, res) => {

        let number =
            normalizeNumber(
                req.query.number
            );

        if (!number) {

            return res.status(400).json({
                success: false,
                error:
                    "WhatsApp number is required."
            });

        }

        /*
         * Validate number.
         */
        const phone =
            pn("+" + number);

        if (!phone.isValid()) {

            return res.status(400).json({
                success: false,
                error:
                    "Invalid international WhatsApp number."
            });

        }

        number =
            phone
                .getNumber("e164")
                .replace("+", "");

        /*
         * Prevent duplicate sockets.
         */
        if (
            activeSessions.has(number)
        ) {

            return res.status(409).json({
                success: false,
                error:
                    "A pairing session is already active for this number. Please wait or try again."
            });

        }

        /*
         * Remove old unfinished session.
         */
        removeSession(number);

        try {

            console.log(
                `🔐 Starting pairing session for ${number}`
            );

            const socket =
                await createSocket(
                    number
                );

            activeSessions.set(
                number,
                socket
            );

            /*
             * Give the WebSocket time to initialize.
             */
            await delay(3000);

            /*
             * Check registration state.
             */
            if (
                socket.authState
                    ?.creds
                    ?.registered
            ) {

                return res.json({
                    success: true,
                    registered: true,
                    message:
                        "This WhatsApp number is already linked."
                });

            }

            console.log(
                `📱 Requesting pairing code for ${number}`
            );

            let code =
                await socket.requestPairingCode(
                    number
                );

            if (!code) {
                throw new Error(
                    "WhatsApp returned an empty pairing code."
                );
            }

            code =
                String(code)
                    .replace(
                        /\s+/g,
                        ""
                    )
                    .match(
                        /.{1,4}/g
                    )
                    ?.join("-") ||
                String(code);

            console.log(
                `🔑 Pair code generated: ${code}`
            );

            return res.json({
                success: true,
                registered: false,
                code,
                number,
                message:
                    "Enter this code in WhatsApp → Linked Devices → Link with phone number."
            });

        } catch (error) {

            console.error(
                "❌ Pairing error:",
                error
            );

            activeSessions.delete(
                number
            );

            if (!res.headersSent) {

                return res.status(503).json({
                    success: false,
                    error:
                        "Unable to generate a WhatsApp pairing code.",
                    details:
                        process.env.NODE_ENV === "production"
                            ? undefined
                            : error.message
                });

            }

        }

    }
);


/*
|--------------------------------------------------------------------------
| SESSION STATUS
|--------------------------------------------------------------------------
*/

router.get(
    "/status",
    async (req, res) => {

        const number =
            normalizeNumber(
                req.query.number
            );

        if (!number) {

            return res.status(400).json({
                success: false,
                error:
                    "Number is required."
            });

        }

        const socket =
            activeSessions.get(
                number
            );

        if (!socket) {

            return res.json({
                success: true,
                connected: false,
                active: false
            });

        }

        return res.json({
            success: true,
            active: true,
            connected:
                Boolean(
                    socket.user
                ),
            registered:
                Boolean(
                    socket.authState
                        ?.creds
                        ?.registered
                )
        });

    }
);


export default router;