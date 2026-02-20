const KEYRING_SERVICE: &str = "com.sourcestack.desktop.google.client_secret";
const KEYRING_USERNAME: &str = "default";

pub struct GoogleClientSecretStore;

impl GoogleClientSecretStore {
    pub fn new() -> Self {
        Self
    }

    pub fn load(&self) -> anyhow::Result<Option<String>> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        let value = match entry.get_password() {
            Ok(v) => v,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(err.into()),
        };

        if value.trim().is_empty() {
            return Ok(None);
        }

        Ok(Some(value))
    }

    pub fn save(&self, secret: &str) -> anyhow::Result<()> {
        let trimmed = secret.trim();
        if trimmed.is_empty() {
            return Ok(());
        }

        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        entry.set_password(trimmed)?;
        Ok(())
    }

    pub fn clear(&self) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}
