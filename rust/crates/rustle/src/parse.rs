use crate::leaf::{Bundle, FieldValue, Leaf, Link, LinkKind};

/// One stanza failed to parse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub line: usize,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

impl std::error::Error for ParseError {}

/// RFC822-like stanzas. Blank line starts a new leaf. `#` comments.
pub fn parse_leaves(text: &str) -> Result<Vec<Leaf>, ParseError> {
    let mut leaves = Vec::new();
    let mut current = LeafBuilder::default();
    let mut started = false;
    for (index, raw) in text.lines().enumerate() {
        let line_no = index + 1;
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            if line.is_empty() && started {
                if !current.is_empty() {
                    leaves.push(current.finish(line_no)?);
                    current = LeafBuilder::default();
                    started = false;
                }
            }
            continue;
        }
        let (key, value) = split_field(line).ok_or_else(|| ParseError {
            line: line_no,
            message: format!("expected `key: value`, got {line}"),
        })?;
        started = true;
        current.apply(line_no, key, value)?;
    }
    if started && !current.is_empty() {
        leaves.push(current.finish(text.lines().count())?);
    }
    Ok(leaves)
}

fn split_field(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((key.trim(), value.trim()))
}

#[derive(Default)]
struct LeafBuilder {
    id: String,
    bundle: Option<Bundle>,
    label: String,
    status: String,
    fields: Vec<(String, FieldValue)>,
    links: Vec<Link>,
    tags: Vec<String>,
}

impl LeafBuilder {
    fn is_empty(&self) -> bool {
        self.id.is_empty()
            && self.bundle.is_none()
            && self.label.is_empty()
            && self.fields.is_empty()
            && self.links.is_empty()
            && self.tags.is_empty()
    }

    fn apply(&mut self, line: usize, key: &str, value: &str) -> Result<(), ParseError> {
        if key == "id" {
            self.id = value.to_string();
            return Ok(());
        }
        if key == "bundle" {
            self.bundle = Some(Bundle::parse(value));
            return Ok(());
        }
        if key == "label" || key == "title" {
            self.label = value.to_string();
            return Ok(());
        }
        if key == "status" {
            self.status = value.to_string();
            return Ok(());
        }
        if key == "tag" {
            if !value.is_empty() && !self.tags.iter().any(|tag| tag == value) {
                self.tags.push(value.to_string());
            }
            return Ok(());
        }
        if let Some(name) = key.strip_prefix("field.") {
            self.fields
                .push((name.to_string(), FieldValue::parse(value)));
            return Ok(());
        }
        if let Some(kind) = key.strip_prefix("link.") {
            let kind = LinkKind::parse(kind).ok_or_else(|| ParseError {
                line,
                message: format!("unknown link kind `{kind}`"),
            })?;
            self.links.push(Link {
                kind,
                target: value.to_string(),
            });
            return Ok(());
        }
        Err(ParseError {
            line,
            message: format!("unknown key `{key}`"),
        })
    }

    fn finish(self, line: usize) -> Result<Leaf, ParseError> {
        if self.id.is_empty() {
            return Err(ParseError {
                line,
                message: "leaf is missing id".into(),
            });
        }
        let bundle = self.bundle.ok_or_else(|| ParseError {
            line,
            message: format!("leaf `{}` is missing bundle", self.id),
        })?;
        let label = if self.label.is_empty() {
            self.id.clone()
        } else {
            self.label
        };
        let mut leaf = Leaf::new(self.id, bundle, label);
        if !self.status.is_empty() {
            leaf.status = self.status;
        }
        for (name, value) in self.fields {
            leaf.fields.insert(name, value);
        }
        leaf.links = self.links;
        leaf.tags = self.tags;
        Ok(leaf)
    }
}
