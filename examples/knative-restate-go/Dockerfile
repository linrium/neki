FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/knative-restate-go .

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=build /out/knative-restate-go /app/knative-restate-go

ENV PORT=9080

EXPOSE 9080

USER 65532:65532

ENTRYPOINT ["/app/knative-restate-go"]
