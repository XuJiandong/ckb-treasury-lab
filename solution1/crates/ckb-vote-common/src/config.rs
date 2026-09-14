//! Loading of the voting system config cell.
//!
//! Every script of the voting system starts by loading the config cell and
//! reading the fields it needs. The config cell is a *cell dependency* of the
//! transaction; see [`crate::deployment`] for how it is recognised.

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        packed::{Byte, Byte32, Script, Uint64},
        prelude::Entity,
    },
    high_level::{load_cell_data, load_cell_type, QueryIter},
};
use ckb_vote_types::molecules::types::VotingConfig;

use crate::{deployment, error::Error, hash};

/// The decoded content of the voting system config cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// When set to `1`, every voting script fails.
    pub emergent_halt: u8,
    /// Code hash of the vote type script.
    pub vote_code_hash: [u8; 32],
    /// Hash type of the vote type script.
    pub vote_hash_type: u8,
    /// Code hash of the counting type script.
    pub counting_code_hash: [u8; 32],
    /// Hash type of the counting type script.
    pub counting_hash_type: u8,
    /// The minimum amount of "YES" votes a proposal needs to be finalized.
    pub yes_threshold: u64,
    /// The minimum capacity (in shannons) of the proposal cell bond.
    pub minimal_proposal_capacity: u64,
    /// Relative block number delay before a proposal can be finalized.
    pub vote_duration: u64,
    /// The number of blocks after the proposal cell in which a vote is valid.
    pub vote_window: u64,
    /// Relative block number delay before a finalized proposal can be passed.
    pub challenge_time: u64,
    /// The lock script hash allowed to veto a finalized proposal.
    pub veto_lock_script_hash: [u8; 32],
}

impl Config {
    /// Decodes a config cell payload.
    pub fn from_data(data: &[u8]) -> Result<Config, Error> {
        let packed = VotingConfig::from_slice(data).map_err(|_| Error::ConfigCellInvalid)?;
        Ok(Config {
            emergent_halt: byte_of(packed.emergent_halt()),
            vote_code_hash: byte32_of(packed.vote_code_hash()),
            vote_hash_type: byte_of(packed.vote_hash_type()),
            counting_code_hash: byte32_of(packed.counting_code_hash()),
            counting_hash_type: byte_of(packed.counting_hash_type()),
            yes_threshold: u64_of(packed.yes_threshold()),
            minimal_proposal_capacity: u64_of(packed.minimal_proposal_capacity()),
            vote_duration: u64_of(packed.vote_duration()),
            vote_window: u64_of(packed.vote_window()),
            challenge_time: u64_of(packed.challenge_time()),
            veto_lock_script_hash: byte32_of(packed.veto_lock_script_hash()),
        })
    }

    /// Loads the config cell from the transaction's cell dependencies.
    ///
    /// The system is halted as soon as `emergent_halt` is set, so a halted
    /// config is reported as an error and never handed out to a script.
    pub fn load() -> Result<Config, Error> {
        let pinned = deployment::config_identity_is_pinned();
        let mut found: Option<Config> = None;

        for (index, type_script) in QueryIter::new(load_cell_type, Source::CellDep).enumerate() {
            let Some(type_script) = type_script else {
                continue;
            };
            let Ok(data) = load_cell_data(index, Source::CellDep) else {
                continue;
            };
            let candidate = if pinned {
                // The deployment pinned the exact script: a matching cell with
                // malformed data is an error, not something to skip.
                if !Self::matches_config_identity(&type_script) {
                    continue;
                }
                Config::from_data(&data)?
            } else {
                // Unpinned development fallback: a Type ID style args plus a
                // well formed payload. Cells that do not decode are ignored so
                // that other 20 byte `args` cells (such as the proposal cell)
                // can be mixed into the same cell deps list.
                if type_script.args().raw_data().len() != deployment::TYPE_ID_ARGS_LEN {
                    continue;
                }
                match Config::from_data(&data).and_then(|config| {
                    config.validate()?;
                    Ok(config)
                }) {
                    Ok(config) => config,
                    Err(_) => continue,
                }
            };
            candidate.validate()?;
            if found.is_some() {
                return Err(Error::ConfigCellAmbiguous);
            }
            found = Some(candidate);
        }

        let config = found.ok_or(Error::ConfigCellNotFound)?;
        if config.emergent_halt != 0 {
            return Err(Error::EmergentHalt);
        }
        Ok(config)
    }

    /// Rejects values that can never be meaningful.
    pub fn validate(&self) -> Result<(), Error> {
        if self.emergent_halt > 1
            || self.vote_hash_type > deployment::MAX_SCRIPT_HASH_TYPE
            || self.counting_hash_type > deployment::MAX_SCRIPT_HASH_TYPE
        {
            return Err(Error::ConfigCellInvalid);
        }
        Ok(())
    }

    /// Tells whether `type_script` is the config type script of this deployment.
    pub fn matches_config_identity(type_script: &Script) -> bool {
        script_matches(
            type_script,
            &deployment::CONFIG_TYPE_SCRIPT_CODE_HASH,
            deployment::CONFIG_TYPE_SCRIPT_HASH_TYPE,
        )
    }

    /// Tells whether `type_script` is the vote type script recorded in the config.
    pub fn is_vote_script(&self, type_script: &Script) -> bool {
        script_matches(type_script, &self.vote_code_hash, self.vote_hash_type)
    }

    /// Tells whether `type_script` is the counting type script recorded in the config.
    pub fn is_counting_script(&self, type_script: &Script) -> bool {
        script_matches(type_script, &self.counting_code_hash, self.counting_hash_type)
    }

    /// Tells whether `type_script` is the proposal type script, as identified by
    /// the 20 byte id stored in vote / counting cells (`blake160(script)`).
    pub fn is_proposal_script(&self, type_script: &Script, proposal_id: &[u8; 20]) -> bool {
        &hash::script_id(type_script) == proposal_id
    }
}

/// Compares the identity of a script against a `(code_hash, hash_type)` pair.
pub fn script_matches(type_script: &Script, code_hash: &[u8; 32], hash_type: u8) -> bool {
    type_script.code_hash().as_slice() == code_hash
        && type_script.hash_type().as_slice()[0] == hash_type
}

/// Loads the config cell and fails when the system has been halted.
///
/// This is the check every script has to perform, including on the paths that
/// do not read any other config field.
pub fn ensure_running() -> Result<(), Error> {
    Config::load().map(|_| ())
}

fn byte_of(value: Byte) -> u8 {
    value.as_slice()[0]
}

fn byte32_of(value: Byte32) -> [u8; 32] {
    let mut buffer = [0u8; 32];
    buffer.copy_from_slice(value.as_slice());
    buffer
}

/// Reads a little endian `Uint64` field.
pub fn u64_of(value: Uint64) -> u64 {
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(value.as_slice());
    u64::from_le_bytes(buffer)
}
