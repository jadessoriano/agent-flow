use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Default)]
struct SecretsIndex {
    keys: Vec<String>,
}

fn secrets_index_path(project_path: &str) -> std::path::PathBuf {
    Path::new(project_path)
        .join(".claude")
        .join("secrets.json")
}

fn keyring_service(project_path: &str) -> String {
    format!("agentflow:{}", project_path)
}

fn read_index(project_path: &str) -> SecretsIndex {
    let path = secrets_index_path(project_path);
    if !path.exists() {
        return SecretsIndex::default();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => SecretsIndex::default(),
    }
}

fn write_index(project_path: &str, index: &SecretsIndex) -> Result<(), String> {
    let path = secrets_index_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize secrets index: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write secrets index: {}", e))
}

#[tauri::command]
pub fn list_secrets(project_path: String) -> Result<Vec<String>, String> {
    let index = read_index(&project_path);
    Ok(index.keys)
}

#[tauri::command]
pub fn set_secret(project_path: String, key: String, value: String) -> Result<(), String> {
    let service = keyring_service(&project_path);
    let entry = keyring::Entry::new(&service, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to store secret: {}", e))?;

    let mut index = read_index(&project_path);
    if !index.keys.contains(&key) {
        index.keys.push(key);
        index.keys.sort();
    }
    write_index(&project_path, &index)?;
    Ok(())
}

#[tauri::command]
pub fn delete_secret(project_path: String, key: String) -> Result<(), String> {
    let service = keyring_service(&project_path);
    let entry = keyring::Entry::new(&service, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    // Ignore error if key doesn't exist in keychain
    let _ = entry.delete_credential();

    let mut index = read_index(&project_path);
    index.keys.retain(|k| k != &key);
    write_index(&project_path, &index)?;
    Ok(())
}

/// Internal function: load all secrets for pipeline execution
pub fn load_secrets(project_path: &str) -> HashMap<String, String> {
    let index = read_index(project_path);
    let service = keyring_service(project_path);
    let mut secrets = HashMap::new();

    for key in &index.keys {
        if let Ok(entry) = keyring::Entry::new(&service, key) {
            if let Ok(value) = entry.get_password() {
                secrets.insert(key.clone(), value);
            }
        }
    }

    secrets
}
