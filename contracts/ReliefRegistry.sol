// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReliefRegistry
/// @notice A shared, tamper-proof registry that lets aid agencies check
///         "has this person already received this type of aid in this campaign?"
///         without anyone ever storing names or ID numbers on-chain.
/// @dev Beneficiaries are identified only by a *nullifier*, computed in the browser as
///      keccak256(abi.encode(campaignSecret, campaignId, normalizedIdNumber)).
///      The contract never sees the ID or the secret; it only stores the 32-byte hash.
///      Aid types are short labels such as "FOOD_KIT", stored as bytes32
///      (ethers: `encodeBytes32String("FOOD_KIT")`).
///
///      People without any government ID can be issued a *Relief ID*: a random card number
///      whose hash is enrolled here and becomes valid once enough approved agencies or
///      community verifiers have vouched for the person. See the "Relief IDs" section.
contract ReliefRegistry is AccessControl {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @notice Trusted authority (e.g. district disaster office) that manages campaigns and agencies.
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    /// @notice Approved NGO / agency allowed to record distributions.
    bytes32 public constant AGENCY_ROLE = keccak256("AGENCY_ROLE");

    /// @notice Trusted community member (village head, health worker, teacher) who can vouch
    ///         for people without government ID. Cannot record distributions.
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ---------------------------------------------------------------------
    // Data structures
    // ---------------------------------------------------------------------

    /// @notice A relief campaign (one disaster response, in one region, over a time window).
    struct Campaign {
        string name;
        string region;
        uint64 startTime; // unix seconds; recording allowed from this moment
        uint64 endTime; // unix seconds; recording allowed until this moment (inclusive)
        bool closed; // set by a coordinator; a closed campaign can never reopen
        bytes32[] aidTypes; // e.g. FOOD_KIT, CASH, MEDICAL, SHELTER
    }

    /// @notice One active distribution record. Fits in a single storage slot (20 + 8 bytes).
    struct Distribution {
        address agency; // who handed out the aid (address(0) means "no record")
        uint64 timestamp; // when it was recorded
    }

    /// @notice One Relief ID card, stored under the hash of its card number.
    struct ReliefId {
        bytes32 root; // hash of the person's FIRST card; a replacement card keeps the same root (0 = not enrolled)
        address enrolledBy; // agency / verifier / coordinator that issued this card
        uint64 enrolledAt; // when this card was issued
        bool revoked; // lost, replaced or fraudulent cards are revoked
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Number of campaigns created so far. Campaign IDs start at 1, so 0 means "none".
    uint256 public campaignCount;

    /// @dev campaignId => campaign details
    mapping(uint256 => Campaign) private _campaigns;

    /// @notice campaignId => aidType => is this aid type part of the campaign?
    mapping(uint256 => mapping(bytes32 => bool)) public isAidTypeInCampaign;

    /// @dev campaignId => nullifier => aidType => distribution record
    mapping(uint256 => mapping(bytes32 => mapping(bytes32 => Distribution))) private _distributions;

    /// @notice campaignId => aidType => number of active (non-voided) distributions
    mapping(uint256 => mapping(bytes32 => uint256)) public totalByAidType;

    /// @notice campaignId => agency => number of active (non-voided) distributions
    mapping(uint256 => mapping(address => uint256)) public totalByAgency;

    /// @notice Human-readable agency name, e.g. "Red Cross District 4".
    /// @dev Kept after removal so old records can still be displayed.
    mapping(address => string) public agencyName;

    /// @notice Display name of a community verifier, e.g. "Riverside Village Council".
    mapping(address => string) public verifierName;

    /// @notice How many distinct vouches a Relief ID needs before it can be used (the enroller counts as one).
    uint256 public vouchThreshold;

    /// @dev cardHash => card
    mapping(bytes32 => ReliefId) private _reliefIds;

    /// @notice root => number of distinct vouchers for this person
    mapping(bytes32 => uint256) public vouchCount;

    /// @notice root => voucher => has this account already vouched for this person?
    mapping(bytes32 => mapping(address => bool)) public hasVouched;

    /// @notice dedupTag => root of the person already enrolled with these details (0 = none).
    /// @dev dedupTag = keccak256(abi.encode(enrollmentSecret, name, parentName, village, birthDecade)),
    ///      computed off-chain, so the same person can't be enrolled twice without anyone storing their details.
    mapping(bytes32 => bytes32) public dedupTagOwner;

    // ---------------------------------------------------------------------
    // Events (the frontend builds the public audit trail from these)
    // ---------------------------------------------------------------------

    event CampaignCreated(
        uint256 indexed campaignId,
        string name,
        string region,
        uint64 startTime,
        uint64 endTime,
        bytes32[] aidTypes,
        address indexed coordinator
    );
    event CampaignClosed(uint256 indexed campaignId, address indexed coordinator);
    event AgencyApproved(address indexed agency, string name, address indexed coordinator);
    event AgencyRemoved(address indexed agency, address indexed coordinator);
    event DistributionRecorded(
        uint256 indexed campaignId,
        bytes32 indexed nullifier,
        bytes32 indexed aidType,
        address agency,
        uint64 timestamp
    );
    event DistributionVoided(
        uint256 indexed campaignId,
        bytes32 indexed nullifier,
        bytes32 indexed aidType,
        address originalAgency,
        address coordinator,
        string reason
    );
    event VerifierApproved(address indexed verifier, string name, address indexed coordinator);
    event VerifierRemoved(address indexed verifier, address indexed coordinator);
    event VouchThresholdChanged(uint256 threshold, address indexed coordinator);
    event ReliefIdEnrolled(bytes32 indexed cardHash, bytes32 indexed dedupTag, address indexed enrolledBy);
    event ReliefIdVouched(bytes32 indexed cardHash, bytes32 indexed root, address indexed voucher, uint256 vouchCount);
    event ReliefIdRevoked(bytes32 indexed cardHash, address indexed coordinator, string reason);
    event ReliefIdReplaced(
        bytes32 indexed oldCardHash,
        bytes32 indexed newCardHash,
        bytes32 indexed root,
        address coordinator,
        string reason
    );

    // ---------------------------------------------------------------------
    // Custom errors (cheaper than revert strings and easy for the frontend to decode)
    // ---------------------------------------------------------------------

    error CampaignNotFound(uint256 campaignId);
    error CampaignIsClosed(uint256 campaignId);
    error CampaignNotActive(uint256 campaignId, uint64 startTime, uint64 endTime);
    error InvalidTimeWindow();
    error EmptyName();
    error NoAidTypes();
    error InvalidAidType(bytes32 aidType);
    error AidTypeNotInCampaign(uint256 campaignId, bytes32 aidType);
    error InvalidNullifier();
    error AlreadyReceived(uint256 campaignId, bytes32 nullifier, bytes32 aidType, address agency, uint64 timestamp);
    error DistributionNotFound(uint256 campaignId, bytes32 nullifier, bytes32 aidType);
    error EmptyBatch();
    error ArrayLengthMismatch();
    error ZeroAddress();
    error EmptyReason();
    error NotAVoucher(address account);
    error InvalidThreshold();
    error InvalidReliefId();
    error ReliefIdExists(bytes32 cardHash);
    error ReliefIdNotFound(bytes32 cardHash);
    error ReliefIdIsRevoked(bytes32 cardHash);
    error MissingDedupTag();
    error PossibleDuplicatePerson(bytes32 existingRoot);
    error AlreadyVouched(bytes32 root, address voucher);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param admin Receives DEFAULT_ADMIN_ROLE (can add/remove coordinators) and COORDINATOR_ROLE.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COORDINATOR_ROLE, admin);
        // Coordinators (not just the admin) are allowed to grant and revoke AGENCY_ROLE.
        _setRoleAdmin(AGENCY_ROLE, COORDINATOR_ROLE);
        _setRoleAdmin(VERIFIER_ROLE, COORDINATOR_ROLE);
        // Enroller + one independent confirmation.
        vouchThreshold = 2;
    }

    // ---------------------------------------------------------------------
    // Coordinator actions
    // ---------------------------------------------------------------------

    /// @notice Create a new relief campaign.
    /// @param name      Display name, e.g. "Flood Relief Demo"
    /// @param region    Region covered, e.g. "District 4"
    /// @param startTime Unix time when recording opens
    /// @param endTime   Unix time when recording closes (must be after startTime)
    /// @param aidTypes  Allowed aid types (bytes32 labels), no duplicates, none empty
    /// @return campaignId The new campaign's ID (starts at 1)
    function createCampaign(
        string calldata name,
        string calldata region,
        uint64 startTime,
        uint64 endTime,
        bytes32[] calldata aidTypes
    ) external onlyRole(COORDINATOR_ROLE) returns (uint256 campaignId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (endTime <= startTime) revert InvalidTimeWindow();
        if (aidTypes.length == 0) revert NoAidTypes();

        campaignId = ++campaignCount;

        for (uint256 i = 0; i < aidTypes.length; i++) {
            bytes32 aidType = aidTypes[i];
            // Reject empty labels and duplicates in the list.
            if (aidType == bytes32(0) || isAidTypeInCampaign[campaignId][aidType]) {
                revert InvalidAidType(aidType);
            }
            isAidTypeInCampaign[campaignId][aidType] = true;
        }

        Campaign storage c = _campaigns[campaignId];
        c.name = name;
        c.region = region;
        c.startTime = startTime;
        c.endTime = endTime;
        c.aidTypes = aidTypes;

        emit CampaignCreated(campaignId, name, region, startTime, endTime, aidTypes, msg.sender);
    }

    /// @notice Permanently close a campaign. No more distributions can be recorded in it.
    function closeCampaign(uint256 campaignId) external onlyRole(COORDINATOR_ROLE) {
        Campaign storage c = _getCampaign(campaignId);
        if (c.closed) revert CampaignIsClosed(campaignId);
        c.closed = true;
        emit CampaignClosed(campaignId, msg.sender);
    }

    /// @notice Approve an agency (or rename an already approved one).
    /// @param agency Wallet address the agency will record from
    /// @param name   Display name shown in the dashboard and in "already received by ..." messages
    function approveAgency(address agency, string calldata name) external onlyRole(COORDINATOR_ROLE) {
        if (agency == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        agencyName[agency] = name;
        _grantRole(AGENCY_ROLE, agency);
        emit AgencyApproved(agency, name, msg.sender);
    }

    /// @notice Remove an agency's permission to record. Its past records stay valid.
    function removeAgency(address agency) external onlyRole(COORDINATOR_ROLE) {
        _revokeRole(AGENCY_ROLE, agency);
        emit AgencyRemoved(agency, msg.sender);
    }

    /// @notice Cancel a wrongly recorded distribution (e.g. typo in the ID).
    /// @dev After voiding, the same nullifier can receive this aid type again.
    ///      The original record stays visible forever in the event log.
    /// @param reason Short explanation, stored in the event for the audit trail
    function voidDistribution(uint256 campaignId, bytes32 nullifier, bytes32 aidType, string calldata reason)
        external
        onlyRole(COORDINATOR_ROLE)
    {
        _getCampaign(campaignId);
        if (bytes(reason).length == 0) revert EmptyReason();

        Distribution memory d = _distributions[campaignId][nullifier][aidType];
        if (d.agency == address(0)) revert DistributionNotFound(campaignId, nullifier, aidType);

        delete _distributions[campaignId][nullifier][aidType];
        totalByAidType[campaignId][aidType] -= 1;
        totalByAgency[campaignId][d.agency] -= 1;

        emit DistributionVoided(campaignId, nullifier, aidType, d.agency, msg.sender, reason);
    }

    // ---------------------------------------------------------------------
    // Agency actions
    // ---------------------------------------------------------------------

    /// @notice Record that a beneficiary (identified only by nullifier) received an aid type.
    /// @dev Reverts with AlreadyReceived if this nullifier already got this aid type in this campaign.
    function recordDistribution(uint256 campaignId, bytes32 nullifier, bytes32 aidType)
        external
        onlyRole(AGENCY_ROLE)
    {
        _requireActive(campaignId);
        _record(campaignId, nullifier, aidType);
    }

    /// @notice Record many distributions in one transaction (cheaper per record).
    /// @dev All-or-nothing: if any entry is invalid or a duplicate (including a duplicate
    ///      *inside the same batch*), the whole batch reverts and nothing is recorded.
    /// @param nullifiers Beneficiary nullifiers
    /// @param aidTypes   Aid type for each nullifier (same length as `nullifiers`)
    function recordBatch(uint256 campaignId, bytes32[] calldata nullifiers, bytes32[] calldata aidTypes)
        external
        onlyRole(AGENCY_ROLE)
    {
        if (nullifiers.length == 0) revert EmptyBatch();
        if (nullifiers.length != aidTypes.length) revert ArrayLengthMismatch();

        // The campaign is checked once for the whole batch: one of the gas savings.
        _requireActive(campaignId);

        for (uint256 i = 0; i < nullifiers.length; i++) {
            _record(campaignId, nullifiers[i], aidTypes[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Relief IDs: identity for people without government documents
    // ---------------------------------------------------------------------
    //
    // 1. An agency or community verifier generates a random card number for the person
    //    (e.g. RID-7KQ2-M9XD-4HPA-TT3W, printed on a card) and enrolls its hash here,
    //    together with a dedupTag that blocks enrolling the same person twice.
    // 2. Other agencies / verifiers who know the person vouch for the card.
    // 3. Once vouchCount >= vouchThreshold, the card is valid. At the Agency Desk the
    //    person's nullifier is computed from the card's root instead of a government ID.
    // 4. A lost card is replaced by a coordinator: the new card keeps the same root,
    //    so the person gets the SAME nullifier and cannot claim aid twice.

    /// @dev Agencies, community verifiers and coordinators can enroll and vouch.
    modifier onlyVoucher() {
        if (
            !hasRole(AGENCY_ROLE, msg.sender) && !hasRole(VERIFIER_ROLE, msg.sender)
                && !hasRole(COORDINATOR_ROLE, msg.sender)
        ) revert NotAVoucher(msg.sender);
        _;
    }

    /// @notice Approve a community verifier (or rename an already approved one).
    function approveVerifier(address verifier, string calldata name) external onlyRole(COORDINATOR_ROLE) {
        if (verifier == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        verifierName[verifier] = name;
        _grantRole(VERIFIER_ROLE, verifier);
        emit VerifierApproved(verifier, name, msg.sender);
    }

    /// @notice Remove a verifier. Their past vouches still count; a coordinator can revoke cards if needed.
    function removeVerifier(address verifier) external onlyRole(COORDINATOR_ROLE) {
        _revokeRole(VERIFIER_ROLE, verifier);
        emit VerifierRemoved(verifier, msg.sender);
    }

    /// @notice Change how many distinct vouches a Relief ID needs. Applies to all cards immediately.
    function setVouchThreshold(uint256 threshold) external onlyRole(COORDINATOR_ROLE) {
        if (threshold == 0) revert InvalidThreshold();
        vouchThreshold = threshold;
        emit VouchThresholdChanged(threshold, msg.sender);
    }

    /// @notice Enroll a new Relief ID card. The enroller's own vouch is counted.
    /// @param cardHash keccak256 of the normalized card number (see shared/reliefId.ts)
    /// @param dedupTag Secret-keyed hash of the person's details. Only a coordinator may pass 0,
    ///                 to enroll a genuinely different person whose details collide with someone else's.
    function enrollReliefId(bytes32 cardHash, bytes32 dedupTag) external onlyVoucher {
        if (cardHash == bytes32(0)) revert InvalidReliefId();
        if (_reliefIds[cardHash].root != bytes32(0)) revert ReliefIdExists(cardHash);

        if (dedupTag == bytes32(0)) {
            if (!hasRole(COORDINATOR_ROLE, msg.sender)) revert MissingDedupTag();
        } else {
            bytes32 existing = dedupTagOwner[dedupTag];
            if (existing != bytes32(0)) revert PossibleDuplicatePerson(existing);
            dedupTagOwner[dedupTag] = cardHash;
        }

        _reliefIds[cardHash] = ReliefId(cardHash, msg.sender, uint64(block.timestamp), false);
        emit ReliefIdEnrolled(cardHash, dedupTag, msg.sender);
        _vouch(cardHash, cardHash);
    }

    /// @notice "I know this person": add your vouch to a Relief ID.
    function vouchForReliefId(bytes32 cardHash) external onlyVoucher {
        ReliefId storage r = _getReliefId(cardHash);
        if (r.revoked) revert ReliefIdIsRevoked(cardHash);
        _vouch(cardHash, r.root);
    }

    /// @notice Revoke a card (stolen, fraudulent, or enrolled by mistake).
    function revokeReliefId(bytes32 cardHash, string calldata reason) external onlyRole(COORDINATOR_ROLE) {
        if (bytes(reason).length == 0) revert EmptyReason();
        ReliefId storage r = _getReliefId(cardHash);
        if (r.revoked) revert ReliefIdIsRevoked(cardHash);
        r.revoked = true;
        emit ReliefIdRevoked(cardHash, msg.sender, reason);
    }

    /// @notice Replace a lost card with a new card number. The new card keeps the person's root
    ///         (and therefore their vouches and their nullifiers), and the old card stops working.
    function replaceReliefId(bytes32 oldCardHash, bytes32 newCardHash, string calldata reason)
        external
        onlyRole(COORDINATOR_ROLE)
    {
        if (bytes(reason).length == 0) revert EmptyReason();
        if (newCardHash == bytes32(0)) revert InvalidReliefId();
        ReliefId storage old = _getReliefId(oldCardHash);
        if (old.revoked) revert ReliefIdIsRevoked(oldCardHash);
        if (_reliefIds[newCardHash].root != bytes32(0)) revert ReliefIdExists(newCardHash);

        old.revoked = true;
        _reliefIds[newCardHash] = ReliefId(old.root, msg.sender, uint64(block.timestamp), false);
        emit ReliefIdReplaced(oldCardHash, newCardHash, old.root, msg.sender, reason);
    }

    /// @notice Everything about a card. `valid` means: enrolled, not revoked, and enough vouches.
    function getReliefId(bytes32 cardHash)
        external
        view
        returns (bytes32 root, address enrolledBy, uint64 enrolledAt, bool revoked, uint256 vouches, bool valid)
    {
        ReliefId memory r = _reliefIds[cardHash];
        vouches = vouchCount[r.root];
        valid = r.root != bytes32(0) && !r.revoked && vouches >= vouchThreshold;
        return (r.root, r.enrolledBy, r.enrolledAt, r.revoked, vouches, valid);
    }

    // ---------------------------------------------------------------------
    // Views (anyone can call these, no wallet needed)
    // ---------------------------------------------------------------------

    /// @notice Has this nullifier already received this aid type in this campaign?
    function hasReceived(uint256 campaignId, bytes32 nullifier, bytes32 aidType) external view returns (bool) {
        return _distributions[campaignId][nullifier][aidType].agency != address(0);
    }

    /// @notice Who recorded the distribution and when. Returns (address(0), 0) if none.
    function getDistribution(uint256 campaignId, bytes32 nullifier, bytes32 aidType)
        external
        view
        returns (address agency, uint64 timestamp)
    {
        Distribution memory d = _distributions[campaignId][nullifier][aidType];
        return (d.agency, d.timestamp);
    }

    /// @notice Full campaign details.
    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _getCampaign(campaignId);
    }

    /// @notice True if the campaign exists, is not closed, and the current time is inside its window.
    function isCampaignActive(uint256 campaignId) public view returns (bool) {
        if (campaignId == 0 || campaignId > campaignCount) return false;
        Campaign storage c = _campaigns[campaignId];
        return !c.closed && block.timestamp >= c.startTime && block.timestamp <= c.endTime;
    }

    /// @notice Counts of active distributions for each of the campaign's aid types (same order as `aidTypes`).
    function getTotalsByAidType(uint256 campaignId)
        external
        view
        returns (bytes32[] memory aidTypes, uint256[] memory counts)
    {
        aidTypes = _getCampaign(campaignId).aidTypes;
        counts = new uint256[](aidTypes.length);
        for (uint256 i = 0; i < aidTypes.length; i++) {
            counts[i] = totalByAidType[campaignId][aidTypes[i]];
        }
    }

    /// @notice True if `account` is currently an approved agency.
    function isAgency(address account) external view returns (bool) {
        return hasRole(AGENCY_ROLE, account);
    }

    /// @notice True if `account` is currently an approved community verifier.
    function isVerifier(address account) external view returns (bool) {
        return hasRole(VERIFIER_ROLE, account);
    }

    /// @notice True if `account` is a coordinator.
    function isCoordinator(address account) external view returns (bool) {
        return hasRole(COORDINATOR_ROLE, account);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Load a campaign or revert if it does not exist.
    function _getCampaign(uint256 campaignId) internal view returns (Campaign storage) {
        if (campaignId == 0 || campaignId > campaignCount) revert CampaignNotFound(campaignId);
        return _campaigns[campaignId];
    }

    /// @dev Load a Relief ID card or revert if it was never enrolled.
    function _getReliefId(bytes32 cardHash) internal view returns (ReliefId storage r) {
        r = _reliefIds[cardHash];
        if (r.root == bytes32(0)) revert ReliefIdNotFound(cardHash);
    }

    /// @dev Count msg.sender's vouch for a person, once per person (not per card).
    function _vouch(bytes32 cardHash, bytes32 root) internal {
        if (hasVouched[root][msg.sender]) revert AlreadyVouched(root, msg.sender);
        hasVouched[root][msg.sender] = true;
        uint256 count = ++vouchCount[root];
        emit ReliefIdVouched(cardHash, root, msg.sender, count);
    }

    /// @dev Revert unless the campaign exists, is open, and is inside its time window.
    function _requireActive(uint256 campaignId) internal view {
        Campaign storage c = _getCampaign(campaignId);
        if (c.closed) revert CampaignIsClosed(campaignId);
        if (block.timestamp < c.startTime || block.timestamp > c.endTime) {
            revert CampaignNotActive(campaignId, c.startTime, c.endTime);
        }
    }

    /// @dev Store one distribution after checking the nullifier, aid type and duplicates.
    ///      Assumes the caller already checked the role and that the campaign is active.
    function _record(uint256 campaignId, bytes32 nullifier, bytes32 aidType) internal {
        if (nullifier == bytes32(0)) revert InvalidNullifier();
        if (!isAidTypeInCampaign[campaignId][aidType]) revert AidTypeNotInCampaign(campaignId, aidType);

        Distribution storage d = _distributions[campaignId][nullifier][aidType];
        if (d.agency != address(0)) {
            revert AlreadyReceived(campaignId, nullifier, aidType, d.agency, d.timestamp);
        }

        uint64 nowTs = uint64(block.timestamp);
        d.agency = msg.sender;
        d.timestamp = nowTs;
        totalByAidType[campaignId][aidType] += 1;
        totalByAgency[campaignId][msg.sender] += 1;

        emit DistributionRecorded(campaignId, nullifier, aidType, msg.sender, nowTs);
    }
}
