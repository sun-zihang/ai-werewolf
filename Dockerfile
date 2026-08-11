# AI 狼人杀 · 生产镜像（前端 + 后端同容器，单域名即可公网访问，无需任何隧道）
FROM node:22-alpine

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm --prefix server install && npm --prefix web install

# 复制源码并构建前端
COPY . .
RUN npm --prefix web run build

# 运行时：后端监听 PORT（云厂商会注入），数据落盘到 /data（挂载卷可持久化）
ENV PORT=3001
ENV AWW_DATA_DIR=/data
ENV NODE_ENV=production
VOLUME ["/data"]
EXPOSE 3001

# 后端直接托管前端（server/src/index.ts 已托管 dist，即仓库根 dist）
CMD ["npm", "--prefix", "server", "run", "start"]
