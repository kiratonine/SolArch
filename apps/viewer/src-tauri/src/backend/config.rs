use std::time::Duration;

use url::Url;

use super::error::BackendError;

#[derive(Clone, Debug)]
pub struct BackendConfig {
    origin: Url,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
}

impl BackendConfig {
    pub fn production() -> Result<Self, BackendError> {
        let configured =
            option_env!("SOLARCH_BACKEND_ORIGIN").ok_or(BackendError::Configuration)?;
        Self::parse(configured, false)
    }

    #[cfg(any(test, feature = "development-fixtures"))]
    pub fn development(origin: &str) -> Result<Self, BackendError> {
        Self::parse(origin, true)
    }

    fn parse(value: &str, allow_loopback_http: bool) -> Result<Self, BackendError> {
        let origin = Url::parse(value).map_err(|_| BackendError::Configuration)?;
        if origin.cannot_be_a_base()
            || origin.username() != ""
            || origin.password().is_some()
            || origin.query().is_some()
            || origin.fragment().is_some()
            || origin.path() != "/"
            || origin.host_str().is_none()
        {
            return Err(BackendError::Configuration);
        }
        let loopback = origin.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if origin.scheme() != "https"
            && !(allow_loopback_http && origin.scheme() == "http" && loopback)
        {
            return Err(BackendError::Configuration);
        }
        if !allow_loopback_http && loopback {
            return Err(BackendError::Configuration);
        }
        Ok(Self {
            origin,
            connect_timeout: Duration::from_secs(5),
            request_timeout: Duration::from_secs(15),
        })
    }

    pub fn origin(&self) -> &Url {
        &self.origin
    }

    pub fn endpoint(&self, relative: &str) -> Result<Url, BackendError> {
        self.origin
            .join(relative)
            .map_err(|_| BackendError::Configuration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_policy_rejects_http_credentials_paths_and_loopback() {
        for value in [
            "http://api.example/",
            "https://user@api.example/",
            "https://api.example/base",
            "https://api.example/?x=1",
            "https://127.0.0.1/",
        ] {
            assert!(BackendConfig::parse(value, false).is_err(), "{value}");
        }
        assert!(BackendConfig::parse("https://api.solarch.example/", false).is_ok());
        assert!(BackendConfig::development("http://127.0.0.1:1234/").is_ok());
        assert!(BackendConfig::development("http://example.com/").is_err());
    }
}
