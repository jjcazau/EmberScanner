FROM docker.io/alpine:latest
LABEL org.opencontainers.image.source="https://github.com/jjcazau/EmberScanner"
WORKDIR /app
ENV DOCKER=1
COPY server/. server/.
RUN mkdir -p /app/data && \
    apk --no-cache --no-progress --virtual .build add go && \
    cd server && \
    go build -o ../ember-scanner && \
    cd .. && \
    rm -fr server /root/.cache /root/go && \
    apk del .build && \
    apk --no-cache --no-progress add ffmpeg mailcap tzdata
VOLUME [ "/app/data" ]
EXPOSE 3000
ENTRYPOINT [ "./ember-scanner", "-base_dir", "/app/data" ]
