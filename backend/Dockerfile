FROM node:20-alpine

WORKDIR /app

# Chromium + fonts for server-side PDF rendering of export documents
# (puppeteer-core drives this system browser; it does not bundle its own).
#
# qpdf strips owner-password encryption before documents are merged. Official
# certificates (phytosanitary, SGS, eCertificates) are routinely issued
# encrypted; pdf-lib cannot decrypt, and loading one with ignoreEncryption
# copies pages that render BLANK rather than failing, so a combined PDF came out
# empty. qpdf --decrypt needs no password when only an owner password is set,
# which is the usual case, and it keeps the text layer intact.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      qpdf
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3001

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Migrate, conditionally seed, then start
CMD ["/app/start.sh"]
