FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 安装依赖（使用 lock 文件保证可复现）
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
 && npm ci --omit=dev

# 应用代码（数据目录通过 volume 挂载）
COPY server.js config.js MIGRATION.md CHANGELOG.md ./
COPY lib/ ./lib/
COPY views/ ./views/
COPY public/ ./public/

RUN mkdir -p /app/posts /app/public/images /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
