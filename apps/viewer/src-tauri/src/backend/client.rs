use std::io::Read;

use reqwest::{
    blocking::{Client, RequestBuilder},
    header::{AUTHORIZATION, CONTENT_TYPE},
    redirect::Policy,
    StatusCode,
};
use serde::{de::DeserializeOwned, Serialize};
use solarch_core::{canonical::parse_bounded, Error as CoreError};

use super::{
    config::BackendConfig,
    dto::{
        ActivationRequest, ActivationResponse, ArchiveMetadataResponse, CreateIntentRequest,
        PaymentIntentResponse, RefreshRequest, VerifyConfirmedResponse, VerifyIntentRequest,
        VerifyPendingResponse, MAX_JSON_DEPTH, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
    },
    error::{BackendError, BackendErrorCode, ErrorResponse},
};

pub trait BackendApi: Send + Sync {
    fn archive_metadata(&self, archive_id: &str) -> Result<ArchiveMetadataResponse, BackendError>;
    fn create_intent(
        &self,
        request: &CreateIntentRequest,
    ) -> Result<PaymentIntentResponse, BackendError>;
    fn verify_intent(
        &self,
        intent_id: &str,
        intent_secret: &str,
        request: &VerifyIntentRequest,
    ) -> Result<VerifyTransport, BackendError>;
    fn activate(
        &self,
        intent_id: &str,
        intent_secret: &str,
        request: &ActivationRequest,
    ) -> Result<ActivationResponse, BackendError>;
    fn refresh(
        &self,
        license_id: &str,
        refresh_token: &str,
        request: &RefreshRequest,
    ) -> Result<solarch_core::license::LicenseGrant, BackendError>;
}

pub enum VerifyTransport {
    Pending(VerifyPendingResponse),
    Confirmed(VerifyConfirmedResponse),
}

pub struct HttpBackendClient {
    config: BackendConfig,
    client: Client,
}

impl HttpBackendClient {
    pub fn new(config: BackendConfig) -> Result<Self, BackendError> {
        let client = Client::builder()
            .connect_timeout(config.connect_timeout)
            .timeout(config.request_timeout)
            .redirect(Policy::none())
            .user_agent(concat!("SolArch-Viewer/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| BackendError::Configuration)?;
        Ok(Self { config, client })
    }

    pub fn config(&self) -> &BackendConfig {
        &self.config
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, BackendError> {
        let url = self.config.endpoint(path)?;
        self.finish(self.client.get(url))
    }

    fn post<Req: Serialize, Res: DeserializeOwned>(
        &self,
        path: &str,
        authorization: Option<&str>,
        request: &Req,
    ) -> Result<Res, BackendError> {
        let bytes = serde_json::to_vec(request).map_err(|_| BackendError::InvalidResponse)?;
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(BackendError::InvalidResponse);
        }
        let mut builder = self
            .client
            .post(self.config.endpoint(path)?)
            .header(CONTENT_TYPE, "application/json")
            .body(bytes);
        if let Some(value) = authorization {
            builder = builder.header(AUTHORIZATION, value);
        }
        self.finish(builder)
    }

    fn finish<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, BackendError> {
        let response = request.send().map_err(|_| BackendError::Unavailable)?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok());
        if !content_type.is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
        }) {
            return Err(BackendError::InvalidResponse);
        }
        let mut body = Vec::new();
        response
            .take(MAX_RESPONSE_BYTES as u64 + 1)
            .read_to_end(&mut body)
            .map_err(|_| BackendError::Unavailable)?;
        if body.is_empty() || body.len() > MAX_RESPONSE_BYTES {
            return Err(BackendError::InvalidResponse);
        }
        if status.is_success() {
            return parse_bounded(&body, MAX_JSON_DEPTH, CoreError::Serialization)
                .map_err(|_| BackendError::InvalidResponse);
        }
        parse_error(status, &body)
    }
}

impl BackendApi for HttpBackendClient {
    fn archive_metadata(&self, archive_id: &str) -> Result<ArchiveMetadataResponse, BackendError> {
        require_id(archive_id)?;
        self.get(&format!("v1/viewer/archives/{archive_id}"))
    }

    fn create_intent(
        &self,
        request: &CreateIntentRequest,
    ) -> Result<PaymentIntentResponse, BackendError> {
        self.post("v1/payment-intents", None, request)
    }

    fn verify_intent(
        &self,
        intent_id: &str,
        intent_secret: &str,
        request: &VerifyIntentRequest,
    ) -> Result<VerifyTransport, BackendError> {
        require_id(intent_id)?;
        super::dto::valid_token32(intent_secret)
            .then_some(())
            .ok_or(BackendError::InvalidResponse)?;
        let value: serde_json::Value = self.post(
            &format!("v1/payment-intents/{intent_id}/verify"),
            Some(&format!("SolArchIntent {intent_secret}")),
            request,
        )?;
        if value.get("status").and_then(serde_json::Value::as_str) == Some("confirmed") {
            serde_json::from_value(value)
                .map(VerifyTransport::Confirmed)
                .map_err(|_| BackendError::InvalidResponse)
        } else {
            serde_json::from_value(value)
                .map(VerifyTransport::Pending)
                .map_err(|_| BackendError::InvalidResponse)
        }
    }

    fn activate(
        &self,
        intent_id: &str,
        intent_secret: &str,
        request: &ActivationRequest,
    ) -> Result<ActivationResponse, BackendError> {
        require_id(intent_id)?;
        if !super::dto::valid_token32(intent_secret) {
            return Err(BackendError::InvalidResponse);
        }
        self.post(
            &format!("v1/payment-intents/{intent_id}/activate-device"),
            Some(&format!("SolArchIntent {intent_secret}")),
            request,
        )
    }

    fn refresh(
        &self,
        license_id: &str,
        refresh_token: &str,
        request: &RefreshRequest,
    ) -> Result<solarch_core::license::LicenseGrant, BackendError> {
        require_id(license_id)?;
        if !super::dto::valid_token32(refresh_token) {
            return Err(BackendError::InvalidResponse);
        }
        self.post(
            &format!("v1/device-licenses/{license_id}/refresh"),
            Some(&format!("DeviceRefresh {refresh_token}")),
            request,
        )
    }
}

fn require_id(value: &str) -> Result<(), BackendError> {
    solarch_core::format::valid_id(value)
        .then_some(())
        .ok_or(BackendError::InvalidResponse)
}

fn parse_error<T>(status: StatusCode, body: &[u8]) -> Result<T, BackendError> {
    let parsed: ErrorResponse = parse_bounded(body, MAX_JSON_DEPTH, CoreError::Serialization)
        .map_err(|_| BackendError::InvalidResponse)?;
    let code = BackendErrorCode::parse(&parsed.code).ok_or(BackendError::InvalidResponse)?;
    if parsed.request_id.is_empty()
        || parsed.request_id.len() > 128
        || !parsed
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(BackendError::InvalidResponse);
    }
    let expected_status = match code {
        BackendErrorCode::InvalidRequest => 400,
        BackendErrorCode::InvalidIntentCredential | BackendErrorCode::InvalidRefreshCredential => {
            401
        }
        BackendErrorCode::ArchiveBlocked
        | BackendErrorCode::PaymentFailed
        | BackendErrorCode::PaymentNotConfirmed
        | BackendErrorCode::EntitlementRevoked
        | BackendErrorCode::LicenseRevoked => 403,
        BackendErrorCode::ArchiveNotAvailable | BackendErrorCode::LicenseNotFound => 404,
        BackendErrorCode::DeviceBindingMismatch
        | BackendErrorCode::DeviceLimitReached
        | BackendErrorCode::RequestNonceReplay => 409,
        BackendErrorCode::PaymentIntentExpired
        | BackendErrorCode::EntitlementExpired
        | BackendErrorCode::LicenseExpired => 410,
        BackendErrorCode::RateLimited => 429,
        BackendErrorCode::BackendUnavailable => 503,
    };
    if status.as_u16() != expected_status {
        return Err(BackendError::InvalidResponse);
    }
    Err(BackendError::Rejected {
        code,
        request_id: Some(parsed.request_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, sync::mpsc, thread, time::Duration};

    #[test]
    fn sanitized_errors_do_not_retain_backend_message_or_credentials() {
        let body = br#"{"code":"RATE_LIMITED","message":"secret AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","request_id":"req_1"}"#;
        let error = parse_error::<()>(StatusCode::TOO_MANY_REQUESTS, body).unwrap_err();
        let debug = format!("{error:?}");
        assert!(debug.contains("RateLimited"));
        assert!(!debug.contains("AAECAw"));
        assert!(error.retryable());
    }

    #[test]
    fn error_schema_status_and_size_fail_closed() {
        assert!(parse_error::<()>(
            StatusCode::BAD_REQUEST,
            br#"{"code":"INVALID_REQUEST","message":"x","request_id":"r","extra":1}"#
        )
        .is_err());
        assert!(parse_error::<()>(
            StatusCode::OK,
            br#"{"code":"INVALID_REQUEST","message":"x","request_id":"r"}"#
        )
        .is_err());
        for (status, code) in [
            (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED"),
            (StatusCode::SERVICE_UNAVAILABLE, "BACKEND_UNAVAILABLE"),
        ] {
            let body =
                format!(r#"{{"code":"{code}","message":"discarded","request_id":"req_retry"}}"#);
            let error = parse_error::<()>(status, body.as_bytes()).unwrap_err();
            assert!(error.retryable());
            assert!(!format!("{error:?}").contains("discarded"));
        }
    }

    #[test]
    fn real_http_boundary_parses_closed_json_and_sends_exact_bearer_scheme() {
        let metadata = format!(
            r#"{{"archive_id":"arc_test_01","status":"published","platform_fee_bps":500,"title":"Test archive","price":{{"amount":"10.00","currency":"USDC"}},"creator":{{"wallet":"11111111111111111111111111111111"}},"license_policy":{{"max_devices":1,"allow_export":false,"watermark_enabled":true}},"archive_fingerprint":"{}"}}"#,
            "a".repeat(64)
        );
        let (origin, request, handle) = serve_once("200 OK", &metadata, Duration::ZERO);
        let client = HttpBackendClient::new(BackendConfig::development(&origin).unwrap()).unwrap();
        let parsed = client.archive_metadata("arc_test_01").unwrap();
        assert_eq!(parsed.archive_id, "arc_test_01");
        assert!(request
            .recv()
            .unwrap()
            .starts_with("GET /v1/viewer/archives/arc_test_01 HTTP/1.1"));
        handle.join().unwrap();

        let (origin, request, handle) = serve_once(
            "200 OK",
            r#"{"verified":false,"status":"pending"}"#,
            Duration::ZERO,
        );
        let client = HttpBackendClient::new(BackendConfig::development(&origin).unwrap()).unwrap();
        assert!(matches!(
            client
                .verify_intent(
                    "pi_test_01",
                    "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                    &VerifyIntentRequest {
                        device_public_key: "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=".into()
                    }
                )
                .unwrap(),
            VerifyTransport::Pending(_)
        ));
        let request = request.recv().unwrap();
        assert!(request
            .contains("authorization: SolArchIntent AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"));
        assert!(request
            .ends_with(r#"{"device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="}"#));
        handle.join().unwrap();
    }

    #[test]
    fn duplicate_oversized_timeout_and_redirect_responses_fail_closed() {
        for (status, body) in [
            (
                "200 OK",
                r#"{"archive_id":"a","archive_id":"a","status":"published","platform_fee_bps":500,"title":"x","price":{"amount":"1.00","currency":"USDC"},"creator":{"wallet":"11111111111111111111111111111111"},"license_policy":{"max_devices":1,"allow_export":false,"watermark_enabled":true},"archive_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#.to_owned(),
            ),
            ("200 OK", " ".repeat(MAX_RESPONSE_BYTES + 1)),
            (
                "302 Found",
                r#"{"code":"BACKEND_UNAVAILABLE","message":"x","request_id":"r"}"#.to_owned(),
            ),
        ] {
            let (origin, _request, handle) = serve_once(status, &body, Duration::ZERO);
            let client = HttpBackendClient::new(BackendConfig::development(&origin).unwrap()).unwrap();
            assert!(client.archive_metadata("arc_test_01").is_err());
            handle.join().unwrap();
        }

        let (origin, _request, handle) = serve_once(
            "200 OK",
            r#"{"archive_id":"arc_test_01"}"#,
            Duration::from_millis(80),
        );
        let mut config = BackendConfig::development(&origin).unwrap();
        config.request_timeout = Duration::from_millis(20);
        let client = HttpBackendClient::new(config).unwrap();
        assert!(matches!(
            client.archive_metadata("arc_test_01"),
            Err(BackendError::Unavailable)
        ));
        handle.join().unwrap();
    }

    fn serve_once(
        status: &'static str,
        body: &str,
        delay: Duration,
    ) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_owned();
        let (sender, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 1024];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let header_end = bytes.windows(4).position(|window| window == b"\r\n\r\n");
                if let Some(position) = header_end {
                    let headers = String::from_utf8_lossy(&bytes[..position + 4]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|value| value.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= position + 4 + length {
                        break;
                    }
                }
            }
            sender.send(String::from_utf8(bytes).unwrap()).unwrap();
            thread::sleep(delay);
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        (format!("http://{address}/"), receiver, handle)
    }
}
