ARG API_IMAGE
FROM ${API_IMAGE}
COPY fixtures/release-compatibility/api.mjs /app/fixture.mjs
ARG FIXTURE_VERSION
ENV FIXTURE_VERSION=$FIXTURE_VERSION
CMD ["node", "/app/fixture.mjs"]
