//! Strict RFC 8785 input/output for the closed v1 JSON schemas.
use std::collections::HashSet;

use serde::{
    de::{DeserializeOwned, Error as DeError, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::{Map, Number, Value};

use crate::{Error, Result};

pub const MAX_JSON_DEPTH: usize = 16;

struct StrictValue(Value);

impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct StrictVisitor;
        impl<'de> Visitor<'de> for StrictVisitor {
            type Value = StrictValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("JSON without duplicate keys or non-integral numbers")
            }
            fn visit_bool<E: DeError>(self, value: bool) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::Bool(value)))
            }
            fn visit_u64<E: DeError>(self, value: u64) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::Number(Number::from(value))))
            }
            fn visit_i64<E: DeError>(self, value: i64) -> std::result::Result<Self::Value, E> {
                if value < 0 {
                    return Err(E::custom("negative integer is not allowed"));
                }
                Ok(StrictValue(Value::Number(Number::from(value))))
            }
            fn visit_f64<E: DeError>(self, _value: f64) -> std::result::Result<Self::Value, E> {
                Err(E::custom("non-integral number is not allowed"))
            }
            fn visit_str<E: DeError>(self, value: &str) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::String(value.to_owned())))
            }
            fn visit_string<E: DeError>(
                self,
                value: String,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::String(value)))
            }
            fn visit_none<E: DeError>(self) -> std::result::Result<Self::Value, E> {
                Err(E::custom("null is not allowed"))
            }
            fn visit_unit<E: DeError>(self) -> std::result::Result<Self::Value, E> {
                Err(E::custom("null is not allowed"))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element::<StrictValue>()? {
                    values.push(value.0);
                }
                Ok(StrictValue(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut object: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut keys = HashSet::new();
                let mut values = Map::new();
                while let Some(key) = object.next_key::<String>()? {
                    if !keys.insert(key.clone()) {
                        return Err(A::Error::custom("duplicate key"));
                    }
                    values.insert(key, object.next_value::<StrictValue>()?.0);
                }
                Ok(StrictValue(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(StrictVisitor)
    }
}

fn depth(value: &Value) -> usize {
    match value {
        Value::Array(values) => 1 + values.iter().map(depth).max().unwrap_or(0),
        Value::Object(values) => 1 + values.values().map(depth).max().unwrap_or(0),
        _ => 0,
    }
}

pub fn to_jcs<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_jcs::to_vec(value).map_err(|_| Error::Serialization)
}

pub fn parse_exact<T: DeserializeOwned + Serialize>(bytes: &[u8], error: Error) -> Result<T> {
    let typed = parse_bounded(bytes, MAX_JSON_DEPTH, error)?;
    if to_jcs(&typed)? != bytes {
        return Err(error);
    }
    Ok(typed)
}

/// Strictly parses a bounded transport JSON value without requiring the wire
/// property order or whitespace to already be RFC 8785 canonical.
pub(crate) fn parse_bounded<T: DeserializeOwned>(
    bytes: &[u8],
    max_depth: usize,
    error: Error,
) -> Result<T> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue::deserialize(&mut deserializer).map_err(|_| error)?;
    deserializer.end().map_err(|_| error)?;
    if depth(&value.0) > max_depth {
        return Err(error);
    }
    serde_json::from_value(value.0).map_err(|_| error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Deserialize, Serialize)]
    #[serde(deny_unknown_fields)]
    struct Sample {
        a: u64,
        b: String,
    }

    #[test]
    fn exact_jcs_accepts_only_canonical_closed_integer_json() {
        assert!(parse_exact::<Sample>(br#"{"a":1,"b":"x"}"#, Error::InvalidHeader).is_ok());
        for bad in [
            br#"{"b":"x","a":1}"#.as_slice(),
            br#"{"a":1,"a":1,"b":"x"}"#,
            br#"{"a":1.0,"b":"x"}"#,
            br#"{"a":1,"b":"x","c":2}"#,
            br#"{"a":1,"b":null}"#,
        ] {
            assert!(parse_exact::<Sample>(bad, Error::InvalidHeader).is_err());
        }
    }
}
