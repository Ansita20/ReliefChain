// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NullifierTestHelper
/// @notice TEST ONLY. Used by the test suite to prove that the TypeScript nullifier code
///         produces exactly the same hash as Solidity's keccak256(abi.encode(...)).
/// @dev NEVER deploy this to a real network and never call it from the frontend:
///      calling it would send the raw ID number to an RPC node, which is exactly what
///      ReliefChain is designed to avoid.
contract NullifierTestHelper {
    function computeNullifier(bytes32 campaignSecret, uint256 campaignId, string calldata normalizedId)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(campaignSecret, campaignId, normalizedId));
    }
}
