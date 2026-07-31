import * as mega from 'megajs';

// Mega authentication credentials from .env
const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    userAgent:
        process.env.MEGA_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
};

// Function to upload a file to Mega and return the URL
export const upload = (data, name) => {
    return new Promise((resolve, reject) => {
        try {
            if (!auth.email || !auth.password) {
                return reject(
                    new Error('MEGA_EMAIL or MEGA_PASSWORD is missing from .env')
                );
            }

            const storage = new mega.Storage(auth, () => {
                const uploadStream = storage.upload({
                    name,
                    allowUploadBuffering: true
                });

                data.pipe(uploadStream);

                storage.on('add', (file) => {
                    file.link((err, url) => {
                        if (err) {
                            storage.close();
                            return reject(err);
                        }

                        storage.close();
                        resolve(url);
                    });
                });

                storage.on('error', (error) => {
                    storage.close();
                    reject(error);
                });
            });
        } catch (err) {
            reject(err);
        }
    });
};

// Function to download a file from Mega using a URL
export const download = (url) => {
    return new Promise((resolve, reject) => {
        try {
            const file = mega.File.fromURL(url);

            file.loadAttributes((err) => {
                if (err) {
                    return reject(err);
                }

                file.downloadBuffer((err, buffer) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(buffer);
                    }
                });
            });
        } catch (err) {
            reject(err);
        }
    });
};